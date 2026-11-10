// SPDX-License-Identifier: Apache-2.0
// SPDX-FileCopyrightText: 2026 Rodolfo Carrillo

import type { JsonValue, Result } from '@ocpptools/core';
import type { Path } from '@ocpptools/schema-utils';

import { limitExceeded, messageOf, notJson } from './errors.js';
import type { BuilderIssue } from './types.js';

export interface JsonLimits {
	readonly maxDepth: number;
	readonly maxNodes: number;
}

interface State {
	readonly limits: JsonLimits;
	readonly seen: WeakSet<object>;
	nodes: number;
}

function fail(path: Path, message: string, value?: unknown): Result<never, BuilderIssue> {
	return { ok: false, error: notJson(path, message, value) };
}

function cloneValue(
	value: unknown,
	path: Path,
	depth: number,
	state: State,
): Result<JsonValue, BuilderIssue> {
	state.nodes += 1;
	if (state.nodes > state.limits.maxNodes) {
		return {
			ok: false,
			error: limitExceeded(path, 'The payload exceeds the configured node limit'),
		};
	}
	if (depth > state.limits.maxDepth) {
		return {
			ok: false,
			error: limitExceeded(path, 'The payload exceeds the configured depth limit'),
		};
	}
	if (value === null || typeof value === 'string' || typeof value === 'boolean') {
		return { ok: true, value };
	}
	if (typeof value === 'number') {
		if (!Number.isFinite(value)) {
			return fail(path, 'Non-finite numbers are not JSON', value);
		}
		return { ok: true, value };
	}
	if (typeof value !== 'object') {
		return fail(path, `${typeof value} is not a JSON value`, value);
	}
	if (state.seen.has(value)) {
		return fail(path, 'The payload contains a cycle', value);
	}
	state.seen.add(value);
	try {
		if (Array.isArray(value)) {
			const result: JsonValue[] = [];
			for (let index = 0; index < value.length; index += 1) {
				if (!Object.hasOwn(value, index)) {
					return fail([...path, index], 'Sparse arrays are not JSON', value);
				}
				const entry = cloneValue(value[index], [...path, index], depth + 1, state);
				if (!entry.ok) return entry;
				result.push(entry.value);
			}
			return { ok: true, value: result };
		}
		const prototype = Reflect.getPrototypeOf(value);
		if (prototype !== Object.prototype && prototype !== null) {
			return fail(path, 'Only plain JSON objects are accepted', value);
		}
		if (Object.getOwnPropertySymbols(value).length > 0) {
			return fail(path, 'Symbol keys are not JSON', value);
		}
		const result: { [key: string]: JsonValue } = {};
		for (const key of Object.keys(value)) {
			const descriptor = Object.getOwnPropertyDescriptor(value, key);
			if (
				descriptor === undefined ||
				descriptor.get !== undefined ||
				descriptor.set !== undefined
			) {
				return fail([...path, key], 'Accessors are not JSON', value);
			}
			const entry = cloneValue(descriptor.value, [...path, key], depth + 1, state);
			if (!entry.ok) return entry;
			Object.defineProperty(result, key, {
				value: entry.value,
				enumerable: true,
				configurable: true,
				writable: true,
			});
		}
		return { ok: true, value: result };
	} finally {
		state.seen.delete(value);
	}
}

/** Copies a plain JSON value and rejects values JSON cannot represent. */
export function cloneJson(value: unknown, limits: JsonLimits): Result<JsonValue, BuilderIssue> {
	try {
		return cloneValue(value, [], 0, {
			limits,
			seen: new WeakSet<object>(),
			nodes: 0,
		});
	} catch (error) {
		return {
			ok: false,
			error: notJson([], messageOf(error, 'The value could not be read as JSON')),
		};
	}
}
