// SPDX-License-Identifier: Apache-2.0
// SPDX-FileCopyrightText: 2026 Rodolfo Carrillo

import { cloneJson } from './clone.js';
import {
	DRAFT_07_SCHEMA_URI,
	detectDraft,
	type SchemaDraft,
	type SupportedDraft,
} from './draft.js';
import { defineData, isJsonObject, ownValue } from './json.js';
import {
	mapSchemaChildren,
	schemaKeywords,
	schemaListKeywords,
	schemaMapKeywords,
} from './keywords.js';
import type { JsonObject, JsonSchema, JsonValue, Path, Result } from './types.js';

export interface NormalizeOptions {
	/** The draft to assume for a schema with no `$schema`. Default: `draft-07`. */
	readonly defaultDraft?: SupportedDraft;
	/**
	 * Remove every keyword that draft-07 does not define, such as `javaType`.
	 * Strict validators reject them. Default: `false`.
	 */
	readonly stripUnknownKeywords?: boolean;
}

/**
 * What `normalizeSchema` changed or could not change:
 *
 * - `unknown-draft`: the `$schema` is not draft-04, draft-06, or draft-07. The
 *   schema is returned as it came.
 * - `id-conflict`: a draft-04 schema has both `id` and `$id`. `$id` is kept and
 *   `id` is dropped.
 * - `ignored-exclusive-bound`: a draft-04 `exclusiveMinimum` or
 *   `exclusiveMaximum` of `true` has no numeric `minimum` or `maximum` to
 *   apply to, so it is dropped.
 */
export type NormalizeWarningCode = 'unknown-draft' | 'id-conflict' | 'ignored-exclusive-bound';

export interface NormalizeWarning {
	readonly code: NormalizeWarningCode;
	readonly message: string;
	/** The schema the warning is about, from the root. */
	readonly path: Path;
}

export interface NormalizedSchema {
	/** The schema in draft-07, as a new value that shares nothing with the input. */
	readonly schema: JsonSchema;
	/** The draft the input was written in. */
	readonly draft: SchemaDraft;
	readonly warnings: readonly NormalizeWarning[];
}

/** The input is not a JSON Schema: it is not JSON, or it is not an object or a boolean. */
export interface NormalizeError {
	readonly kind: 'invalid-schema';
	readonly message: string;
	/** Where the problem is, from the root of the input. */
	readonly path: Path;
}

interface Context {
	readonly draft: SupportedDraft;
	readonly strip: boolean;
	readonly warnings: NormalizeWarning[];
}

const draft07Keywords = new Set([
	...schemaKeywords,
	...schemaListKeywords,
	...schemaMapKeywords,
	'$comment',
	'$id',
	'$ref',
	'$schema',
	'const',
	'contentEncoding',
	'contentMediaType',
	'default',
	'description',
	'enum',
	'examples',
	'exclusiveMaximum',
	'exclusiveMinimum',
	'format',
	'items',
	'maxItems',
	'maxLength',
	'maxProperties',
	'maximum',
	'minItems',
	'minLength',
	'minProperties',
	'minimum',
	'multipleOf',
	'pattern',
	'readOnly',
	'required',
	'title',
	'type',
	'uniqueItems',
	'writeOnly',
]);

function normalizeNode(node: JsonValue, path: Path, context: Context, isRoot: boolean): JsonValue {
	if (!isJsonObject(node)) {
		return node;
	}
	const legacy = context.draft === 'draft-04';
	const rewriteUri = isRoot && context.draft !== 'draft-07';
	const copy: JsonObject = {};
	if (rewriteUri && !Object.hasOwn(node, '$schema')) {
		defineData(copy, '$schema', DRAFT_07_SCHEMA_URI);
	}
	for (const [key, value] of Object.entries(node)) {
		if (legacy && key === 'id' && typeof value === 'string') {
			if (Object.hasOwn(node, '$id')) {
				context.warnings.push({
					code: 'id-conflict',
					message: 'The schema has both "id" and "$id". "$id" is kept and "id" is dropped.',
					path,
				});
			} else {
				defineData(copy, '$id', value);
			}
			continue;
		}
		if (legacy && (key === 'minimum' || key === 'maximum') && typeof value === 'number') {
			// A draft-04 bound with `exclusiveMinimum: true` becomes `exclusiveMinimum: value`.
			const flag = key === 'minimum' ? 'exclusiveMinimum' : 'exclusiveMaximum';
			if (ownValue(node, flag) === true) {
				continue;
			}
		}
		if (legacy && (key === 'exclusiveMinimum' || key === 'exclusiveMaximum')) {
			if (typeof value === 'boolean') {
				const limit = ownValue(node, key === 'exclusiveMinimum' ? 'minimum' : 'maximum');
				if (value && typeof limit === 'number') {
					defineData(copy, key, limit);
				} else if (value) {
					context.warnings.push({
						code: 'ignored-exclusive-bound',
						message: `"${key}" is true but there is no numeric bound to make exclusive. It is dropped.`,
						path,
					});
				}
				continue;
			}
		}
		if (rewriteUri && key === '$schema' && typeof value === 'string') {
			defineData(copy, key, DRAFT_07_SCHEMA_URI);
			continue;
		}
		if (context.strip && !draft07Keywords.has(key)) {
			continue;
		}
		defineData(
			copy,
			key,
			mapSchemaChildren(key, value, path, (child, childPath) =>
				normalizeNode(child, childPath, context, false),
			),
		);
	}
	return copy;
}

function invalid(message: string, path: Path): Result<never, NormalizeError> {
	return { ok: false, error: { kind: 'invalid-schema', message, path } };
}

/**
 * Converts a draft-04, draft-06, or draft-07 schema to draft-07. The input is
 * not changed, and the result shares nothing with it.
 *
 * - Draft-04 to draft-07: `id` becomes `$id`, a boolean `exclusiveMinimum` or
 *   `exclusiveMaximum` becomes the numeric form, and `$schema` is updated.
 * - Draft-06 to draft-07: only `$schema` is updated.
 * - Draft-07: nothing changes.
 *
 * Only schema positions are converted (`properties` values, `items`,
 * `definitions`, and so on). A property that is called `id` or `type`, and the
 * contents of `enum`, `default`, and unknown keywords, are data and stay as
 * they are. Unknown keywords are kept unless `stripUnknownKeywords` is set.
 *
 * A schema with an unsupported `$schema` is returned unchanged, with an
 * `unknown-draft` warning, and `stripUnknownKeywords` does not apply to it,
 * because there is no list of known keywords. Input that is not JSON, or is not an object or a
 * boolean, is an `invalid-schema` error.
 *
 * Draft-04 `1.0` counts as an integer from draft-06 on. A value cannot be
 * rewritten to reflect that, so it is not reported either.
 */
export function normalizeSchema(
	schema: unknown,
	options: NormalizeOptions = {},
): Result<NormalizedSchema, NormalizeError> {
	const copy = cloneJson(schema);
	if (!copy.ok) {
		return invalid(copy.error.message, copy.error.path);
	}
	const root = copy.value;
	if (typeof root !== 'boolean' && !isJsonObject(root)) {
		return invalid('A schema must be an object or a boolean', []);
	}
	const draft = detectDraft(root, options.defaultDraft ?? 'draft-07');
	if (draft === 'unknown') {
		const uri = JSON.stringify((root as JsonObject).$schema);
		const warning: NormalizeWarning = {
			code: 'unknown-draft',
			message: `Unsupported $schema ${uri}. The schema is returned unchanged.`,
			path: [],
		};
		return { ok: true, value: { schema: root, draft, warnings: [warning] } };
	}
	const context: Context = {
		draft,
		strip: options.stripUnknownKeywords === true,
		warnings: [],
	};
	const normalized = normalizeNode(root, [], context, true);
	return {
		ok: true,
		value: { schema: normalized as JsonSchema, draft, warnings: context.warnings },
	};
}
