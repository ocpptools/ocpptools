// SPDX-License-Identifier: Apache-2.0
// SPDX-FileCopyrightText: 2026 Rodolfo Carrillo

import { cloneJson } from './clone.js';
import { copyJson, defineData, isJsonObject, ownValue } from './json.js';
import { mapSchemaChildren } from './keywords.js';
import { getByPointer, parseLocalRef } from './pointer.js';
import type { JsonObject, JsonValue, Path, ResolvedJsonSchema, Result } from './types.js';

/** The default for `ResolveOptions.maxDepth`. */
export const DEFAULT_MAX_DEPTH = 128;
/** The largest `maxDepth` that is honored, so the call stack cannot overflow. */
export const MAX_DEPTH_LIMIT = 256;
/** The default for `ResolveOptions.maxNodes`. */
export const DEFAULT_MAX_NODES = 100_000;

export interface ResolveOptions {
	/**
	 * The deepest nesting of schemas allowed in the result. Following a `$ref`
	 * counts as one level. Default 128, at most 256. A value that is not a
	 * positive integer is ignored.
	 */
	readonly maxDepth?: number;
	/**
	 * The most schemas the result may contain, counting each time a referenced
	 * schema is inlined. This stops a schema whose references fan out from
	 * growing without bound. Default 100000. A value that is not a positive
	 * integer is ignored.
	 */
	readonly maxNodes?: number;
	/**
	 * Remove the `definitions` keyword from every schema. They are unused once
	 * references are inlined, and they are not checked either, so a definition
	 * that nothing refers to can then be broken or recursive. Default `false`.
	 */
	readonly dropDefinitions?: boolean;
}

/**
 * Why a schema could not be resolved:
 *
 * - `invalid-schema`: the input is not JSON, is not an object or a boolean, or
 *   has a `$ref` that is not a string.
 * - `unresolved-ref`: nothing is at the reference, or what is there is not a
 *   schema.
 * - `external-ref`: the reference points outside the document. Nothing is
 *   fetched.
 * - `circular-ref`: the reference leads back to itself, so inlining it would
 *   never end.
 * - `invalid-pointer`: the reference is malformed, or is an anchor such as
 *   `#foo`, which is not supported.
 * - `limit-exceeded`: the result would be deeper than `maxDepth` or larger than
 *   `maxNodes`.
 */
export type ResolveErrorKind =
	| 'invalid-schema'
	| 'unresolved-ref'
	| 'external-ref'
	| 'circular-ref'
	| 'invalid-pointer'
	| 'limit-exceeded';

export interface ResolveError {
	readonly kind: ResolveErrorKind;
	readonly message: string;
	/** Where the problem is in the input: the schema that has the bad `$ref`. */
	readonly path: Path;
	/** The reference that caused it, when there is one. */
	readonly ref?: string;
}

interface State {
	/** The input, which every reference is looked up in. */
	readonly document: JsonValue;
	readonly maxDepth: number;
	readonly maxNodes: number;
	readonly dropDefinitions: boolean;
	nodes: number;
	/** The first failure. Once set, the rest of the walk only unwinds. */
	failure?: ResolveError;
}

function limit(value: number | undefined, fallback: number, ceiling: number): number {
	return value !== undefined && Number.isSafeInteger(value) && value > 0
		? Math.min(value, ceiling)
		: fallback;
}

function fail(
	state: State,
	kind: ResolveErrorKind,
	message: string,
	path: Path,
	ref?: string,
): JsonValue {
	const error: ResolveError =
		ref === undefined ? { kind, message, path } : { kind, message, path, ref };
	state.failure = error;
	return null;
}

/** Whether `prefix` is `location` or one of the schemas that contain it. */
function isPrefix(prefix: readonly string[], location: Path): boolean {
	return (
		prefix.length <= location.length &&
		prefix.every((segment, index) => segment === String(location[index]))
	);
}

function resolveNode(
	node: JsonValue,
	path: Path,
	chain: readonly Path[],
	depth: number,
	state: State,
): JsonValue {
	state.nodes++;
	if (state.nodes > state.maxNodes) {
		return fail(
			state,
			'limit-exceeded',
			`The result has more than ${String(state.maxNodes)} schemas`,
			path,
		);
	}
	if (depth > state.maxDepth) {
		return fail(
			state,
			'limit-exceeded',
			`The result is nested deeper than ${String(state.maxDepth)}`,
			path,
		);
	}
	if (!isJsonObject(node)) {
		return copyJson(node);
	}
	const ref = ownValue(node, '$ref');
	if (ref !== undefined) {
		return resolveRef(ref, path, chain, depth, state);
	}
	const copy: JsonObject = {};
	for (const [key, value] of Object.entries(node)) {
		if (state.dropDefinitions && key === 'definitions') {
			continue;
		}
		const resolved = mapSchemaChildren(key, value, path, (child, childPath) =>
			state.failure === undefined ? resolveNode(child, childPath, chain, depth + 1, state) : child,
		);
		// A value that no schema was found in (`enum`, `default`) comes back as it
		// was, and is copied so that two inlined references do not share it.
		defineData(copy, key, resolved === value ? copyJson(value) : resolved);
	}
	return copy;
}

function resolveRef(
	ref: JsonValue,
	path: Path,
	chain: readonly Path[],
	depth: number,
	state: State,
): JsonValue {
	if (typeof ref !== 'string') {
		return fail(state, 'invalid-schema', '"$ref" must be a string', path);
	}
	const parsed = parseLocalRef(ref);
	if (!parsed.ok) {
		return fail(state, parsed.error.kind, parsed.error.message, path, ref);
	}
	const target = parsed.value;
	// A reference to this schema, or to one that contains it or a schema being
	// resolved above it, would be inlined into itself forever.
	if ([...chain, path].some((location) => isPrefix(target, location))) {
		return fail(state, 'circular-ref', `The reference ${ref} leads back to itself`, path, ref);
	}
	const found = getByPointer(state.document, target);
	if (!found.found) {
		return fail(state, 'unresolved-ref', `Nothing is at ${ref}`, path, ref);
	}
	const schema = found.value;
	if (typeof schema !== 'boolean' && !isJsonObject(schema)) {
		return fail(state, 'unresolved-ref', `${ref} does not point to a schema`, path, ref);
	}
	return resolveNode(schema, target, [...chain, path], depth + 1, state);
}

/**
 * Replaces every `$ref` in a schema with the schema it points to. Only
 * references inside the same document are followed (`#`, `#/definitions/Name`);
 * an external reference is an error and nothing is fetched. The input is not
 * changed, and the result is a new tree that shares nothing with it, so the
 * same definition used twice appears as two separate copies.
 *
 * As in draft-07, a schema that has `$ref` is replaced by its target, and its
 * other keywords are ignored. Only schema positions are read, so `$ref` inside
 * `enum`, `default`, or an unknown keyword is data and stays. Run
 * `normalizeSchema` first if the input may be draft-04: this function does not
 * read `id`.
 *
 * Cycles are found by following the chain of references, not by a depth limit,
 * and are an error (`circular-ref`). `maxDepth` and `maxNodes` bound the size of
 * the result, and exceeding them is an error too. A schema is never cut short.
 */
export function resolveRefs(
	schema: unknown,
	options: ResolveOptions = {},
): Result<ResolvedJsonSchema, ResolveError> {
	const copy = cloneJson(schema);
	if (!copy.ok) {
		const { message, path } = copy.error;
		return { ok: false, error: { kind: 'invalid-schema', message, path } };
	}
	const root = copy.value;
	if (typeof root !== 'boolean' && !isJsonObject(root)) {
		return {
			ok: false,
			error: {
				kind: 'invalid-schema',
				message: 'A schema must be an object or a boolean',
				path: [],
			},
		};
	}
	const state: State = {
		document: root,
		maxDepth: limit(options.maxDepth, DEFAULT_MAX_DEPTH, MAX_DEPTH_LIMIT),
		maxNodes: limit(options.maxNodes, DEFAULT_MAX_NODES, Number.MAX_SAFE_INTEGER),
		dropDefinitions: options.dropDefinitions === true,
		nodes: 0,
	};
	const resolved = resolveNode(root, [], [], 0, state);
	if (state.failure !== undefined) {
		return { ok: false, error: state.failure };
	}
	return { ok: true, value: resolved as ResolvedJsonSchema };
}
