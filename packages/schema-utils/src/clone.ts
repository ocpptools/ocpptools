// SPDX-License-Identifier: Apache-2.0
// SPDX-FileCopyrightText: 2026 Rodolfo Carrillo

import type { JsonValue, Path, PathSegment, Result } from './types.js';

/**
 * Why a value could not be cloned:
 *
 * - `not-json`: the value, or something inside it, is not JSON.
 * - `circular`: an object or array contains itself.
 * - `too-deep`: the value is nested deeper than `MAX_CLONE_DEPTH`.
 */
export type CloneErrorKind = 'not-json' | 'circular' | 'too-deep';

export interface CloneError {
	readonly kind: CloneErrorKind;
	readonly message: string;
	/** Where the problem is, from the root of the value. */
	readonly path: Path;
}

/** The deepest nesting `cloneJson` accepts, so hostile input cannot exhaust the stack. */
export const MAX_CLONE_DEPTH = 512;

function fail(kind: CloneErrorKind, message: string, path: Path): Result<never, CloneError> {
	return { ok: false, error: { kind, message, path: [...path] } };
}

function cloneArray(
	items: readonly unknown[],
	path: PathSegment[],
	ancestors: Set<object>,
): Result<JsonValue[], CloneError> {
	const copy: JsonValue[] = [];
	for (let index = 0; index < items.length; index++) {
		path.push(index);
		if (!Object.hasOwn(items, index)) {
			return fail('not-json', 'A sparse array is not JSON', path);
		}
		const item = cloneValue(items[index], path, ancestors);
		if (!item.ok) {
			return item;
		}
		path.pop();
		copy.push(item.value);
	}
	return { ok: true, value: copy };
}

function cloneObject(
	source: object,
	path: PathSegment[],
	ancestors: Set<object>,
): Result<{ [key: string]: JsonValue }, CloneError> {
	const prototype = Object.getPrototypeOf(source) as unknown;
	if (prototype !== Object.prototype && prototype !== null) {
		return fail('not-json', 'Only plain objects are JSON', path);
	}
	const copy: { [key: string]: JsonValue } = {};
	for (const [key, descriptor] of Object.entries(Object.getOwnPropertyDescriptors(source))) {
		if (descriptor.enumerable !== true) {
			continue;
		}
		path.push(key);
		if (!('value' in descriptor)) {
			return fail('not-json', 'An accessor property is not JSON', path);
		}
		const property = cloneValue(descriptor.value, path, ancestors);
		if (!property.ok) {
			return property;
		}
		path.pop();
		// A plain assignment of "__proto__" would change the prototype of `copy`.
		Object.defineProperty(copy, key, {
			value: property.value,
			writable: true,
			enumerable: true,
			configurable: true,
		});
	}
	return { ok: true, value: copy };
}

function cloneValue(
	value: unknown,
	path: PathSegment[],
	ancestors: Set<object>,
): Result<JsonValue, CloneError> {
	if (value === null || typeof value === 'string' || typeof value === 'boolean') {
		return { ok: true, value };
	}
	if (typeof value === 'number') {
		return Number.isFinite(value)
			? { ok: true, value }
			: fail('not-json', 'A number must be finite to be JSON', path);
	}
	if (typeof value !== 'object') {
		return fail('not-json', `A value of type ${typeof value} is not JSON`, path);
	}
	if (ancestors.has(value)) {
		return fail('circular', 'The value contains itself', path);
	}
	if (path.length >= MAX_CLONE_DEPTH) {
		return fail('too-deep', `The value is nested deeper than ${String(MAX_CLONE_DEPTH)}`, path);
	}
	ancestors.add(value);
	const copy = Array.isArray(value)
		? cloneArray(value, path, ancestors)
		: cloneObject(value, path, ancestors);
	ancestors.delete(value);
	return copy;
}

/**
 * Returns a deep copy of a JSON value, or says why the input is not one. The
 * copy shares nothing with the input. Only plain objects, arrays, strings,
 * finite numbers, booleans, and `null` are accepted; everything else
 * (`undefined`, functions, symbols, BigInt, `Date`, `Map`, class instances,
 * accessors, sparse arrays, circular structures) is rejected with its path.
 * Property names such as `__proto__` are copied as ordinary data.
 */
export function cloneJson(value: unknown): Result<JsonValue, CloneError> {
	return cloneValue(value, [], new Set());
}
