// SPDX-License-Identifier: Apache-2.0
// SPDX-FileCopyrightText: 2026 Rodolfo Carrillo

import { cloneJson } from './clone.js';
import { getFields, type Field, type FieldKind } from './fields.js';
import { defineData, isJsonObject } from './json.js';
import type { JsonObject, JsonValue, Path, ResolvedJsonSchema, Result } from './types.js';

/**
 * What a required value gets when the schema gives it neither a `default` nor
 * an `enum`:
 *
 * - `default-or-enum`: nothing, so the value is left out of the payload.
 * - `typed-zero`: `''` for a string, `0` for a number or integer, and `false`
 *   for a boolean.
 */
export type EmptyPayloadFill = 'default-or-enum' | 'typed-zero';

export interface EmptyPayloadOptions {
	/** Default: `default-or-enum`. */
	readonly fill?: EmptyPayloadFill;
}

/** The value is not JSON, so defaults cannot be applied to it. */
export interface ApplyDefaultsError {
	readonly kind: 'invalid-value';
	readonly message: string;
	/** Where the problem is, from the root of the value. */
	readonly path: Path;
}

const zeros: ReadonlyMap<FieldKind, JsonValue> = new Map<FieldKind, JsonValue>([
	['string', ''],
	['number', 0],
	['integer', 0],
	['boolean', false],
]);

function leafValue(field: Field, fill: EmptyPayloadFill): JsonValue | undefined {
	if (field.kind === 'null') {
		// The only value `null` allows.
		return null;
	}
	if (field.default !== undefined) {
		return field.default;
	}
	const first = field.enum?.[0];
	if (first !== undefined) {
		return first;
	}
	return fill === 'typed-zero' ? zeros.get(field.kind) : undefined;
}

function emptyValue(field: Field, fill: EmptyPayloadFill): JsonValue | undefined {
	// Only an object has `children`.
	const { children } = field;
	if (children !== undefined) {
		const payload: JsonObject = {};
		for (const child of children) {
			if (!child.required || child.name === undefined) {
				continue;
			}
			const value = emptyValue(child, fill);
			if (value !== undefined) {
				defineData(payload, child.name, value);
			}
		}
		return payload;
	}
	if (field.kind === 'array') {
		return [];
	}
	return field.kind === 'unsupported' ? undefined : leafValue(field, fill);
}

/**
 * Builds the smallest payload that has every required value the schema can
 * fill in. It takes a schema from `resolveRefs`.
 *
 * - A required object is expanded with its required properties.
 * - A required array is empty, even when it has `minItems`.
 * - A required value of any other type is its `default`, else the first value
 *   of its `enum`, else it is left out (see `fill`). `null` is always `null`.
 * - Properties that are not required are left out, even when they have a
 *   `default`; use `applyDefaults` for those.
 * - A required value that cannot be described (`oneOf` and the like) is left
 *   out.
 *
 * It does not throw and does not change the schema. It returns `undefined` when
 * the schema as a whole has no value to give, for example a plain string with
 * no `default` or `enum`. The payload may therefore not satisfy the schema:
 * a required property with no known value is missing.
 */
export function createEmptyPayload(
	schema: ResolvedJsonSchema,
	options: EmptyPayloadOptions = {},
): JsonValue | undefined {
	return emptyValue(getFields(schema), options.fill ?? 'default-or-enum');
}

function withDefaults(field: Field, value: JsonValue): JsonValue {
	const { children } = field;
	if (children !== undefined && isJsonObject(value)) {
		const known = new Map(children.map((child) => [child.name, child]));
		const payload: JsonObject = {};
		for (const [key, entry] of Object.entries(value)) {
			const child = known.get(key);
			defineData(payload, key, child === undefined ? entry : withDefaults(child, entry));
		}
		for (const child of children) {
			if (child.name === undefined || child.default === undefined) {
				continue;
			}
			if (!Object.hasOwn(value, child.name)) {
				defineData(payload, child.name, withDefaults(child, child.default));
			}
		}
		return payload;
	}
	if (field.kind === 'array' && Array.isArray(value)) {
		return value.map((entry, index) => {
			const target = field.tuple?.[index] ?? field.item;
			return target === undefined ? entry : withDefaults(target, entry);
		});
	}
	return value;
}

/**
 * Returns a copy of `value` with the `default` of every property that is
 * missing from it, like Ajv's `useDefaults`. It takes a schema from
 * `resolveRefs`.
 *
 * - A property that is present is never changed, including `0`, `false`, `''`,
 *   and `null`.
 * - A parent object is never created just to hold a default. A default that is
 *   itself an object gets the defaults of its own properties.
 * - Properties the schema does not mention are kept. Values of the wrong type
 *   are left alone, and nothing is coerced.
 * - Objects inside arrays get their defaults too, by `items` or by position.
 * - A default is inserted whether or not the property is required.
 *
 * `value` is not changed. A value that is not JSON is an `invalid-value`
 * error.
 */
export function applyDefaults(
	schema: ResolvedJsonSchema,
	value: unknown,
): Result<JsonValue, ApplyDefaultsError> {
	const copy = cloneJson(value);
	if (!copy.ok) {
		const { message, path } = copy.error;
		return { ok: false, error: { kind: 'invalid-value', message, path } };
	}
	return { ok: true, value: withDefaults(getFields(schema), copy.value) };
}
