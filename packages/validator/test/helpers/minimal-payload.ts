// SPDX-License-Identifier: Apache-2.0
// SPDX-FileCopyrightText: 2026 Rodolfo Carrillo

import { normalizeSchema, resolveRefs } from '@ocpptools/schema-utils';

import { createAjv } from '../../src/ajv.js';

type JsonObject = Record<string, unknown>;

const ajv = createAjv();

function isObject(value: unknown): value is JsonObject {
	return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function clone(value: unknown): unknown {
	if (Array.isArray(value)) {
		return value.map((entry) => clone(entry));
	}
	if (isObject(value)) {
		return Object.fromEntries(Object.entries(value).map(([key, entry]) => [key, clone(entry)]));
	}
	return value;
}

function numberAt(schema: JsonObject, key: string): number | undefined {
	const value = schema[key];
	return typeof value === 'number' ? value : undefined;
}

function typeOf(schema: JsonObject): string | undefined {
	const type = schema['type'];
	if (typeof type === 'string') {
		return type;
	}
	if (Array.isArray(type) && typeof type[0] === 'string') {
		return type[0];
	}
	return undefined;
}

function stringFor(schema: JsonObject): string {
	const minimum = numberAt(schema, 'minLength') ?? 0;
	const maximum = numberAt(schema, 'maxLength');
	if (maximum !== undefined && maximum < minimum) {
		throw new Error('maxLength is smaller than minLength');
	}
	const format = schema['format'];
	if (format === 'date-time' || format === 'uri') {
		const value = format === 'date-time' ? '2026-01-01T00:00:00Z' : 'https://example.com';
		if (value.length < minimum || (maximum !== undefined && value.length > maximum)) {
			throw new Error(`The ${format} value does not satisfy the length constraints`);
		}
		return value;
	}
	if (format !== undefined) {
		throw new Error(`Unsupported format ${typeof format === 'string' ? format : 'unknown'}`);
	}
	if (schema['pattern'] !== undefined) {
		throw new Error('Patterns are not supported by the minimal payload helper');
	}
	return 'x'.repeat(maximum !== undefined ? Math.min(minimum, maximum) : minimum);
}

function numberFor(schema: JsonObject): number {
	const multiple = numberAt(schema, 'multipleOf');
	if (multiple !== undefined && multiple <= 0) {
		throw new Error('multipleOf must be positive');
	}
	const minimum = numberAt(schema, 'minimum');
	const maximum = numberAt(schema, 'maximum');
	const exclusiveMinimum = numberAt(schema, 'exclusiveMinimum');
	const exclusiveMaximum = numberAt(schema, 'exclusiveMaximum');
	const integer = typeOf(schema) === 'integer';
	const inBounds = (value: number): boolean =>
		(minimum === undefined || value >= minimum) &&
		(maximum === undefined || value <= maximum) &&
		(exclusiveMinimum === undefined || value > exclusiveMinimum) &&
		(exclusiveMaximum === undefined || value < exclusiveMaximum);
	const round = (value: number): number => Number(value.toFixed(6));

	if (multiple !== undefined) {
		const lower = Math.max(minimum ?? -Infinity, exclusiveMinimum ?? -Infinity);
		const upper = Math.min(maximum ?? Infinity, exclusiveMaximum ?? Infinity);
		const start = Number.isFinite(lower) ? Math.ceil(lower / multiple - 1e-9) : 0;
		const end = Number.isFinite(upper) ? Math.floor(upper / multiple + 1e-9) : start + 1000;
		for (let index = start; index <= end; index += 1) {
			const value = round(index * multiple);
			if (!inBounds(value) || (integer && !Number.isInteger(value))) {
				continue;
			}
			return value;
		}
		throw new Error('No numeric value satisfies multipleOf and the bounds');
	}

	let lower = minimum ?? -Infinity;
	if (exclusiveMinimum !== undefined) {
		lower = Math.max(lower, exclusiveMinimum);
	}
	let upper = maximum ?? Infinity;
	if (exclusiveMaximum !== undefined) {
		upper = Math.min(upper, exclusiveMaximum);
	}
	let value = Number.isFinite(lower) ? lower : Number.isFinite(upper) ? upper : 0;
	if (exclusiveMinimum !== undefined && value <= exclusiveMinimum) {
		value = exclusiveMinimum + (Number.isFinite(upper) ? (upper - exclusiveMinimum) / 2 : 1);
	}
	if (exclusiveMaximum !== undefined && value >= exclusiveMaximum) {
		value = exclusiveMaximum - (Number.isFinite(lower) ? (exclusiveMaximum - lower) / 2 : 1);
	}
	if (integer) {
		value = Math.ceil(value);
	}
	if (!inBounds(value)) {
		if (integer && Number.isFinite(upper)) {
			value = Math.floor(upper);
		}
	}
	if (!inBounds(value)) {
		throw new Error('The numeric bounds have no value');
	}
	return round(value);
}

function arrayFor(schema: JsonObject, depth: number): unknown[] {
	const items = schema['items'];
	if (Array.isArray(items)) {
		throw new Error('Tuple items are not supported by the minimal payload helper');
	}
	const minimum = numberAt(schema, 'minItems') ?? 0;
	const maximum = numberAt(schema, 'maxItems');
	if (maximum !== undefined && maximum < minimum) {
		throw new Error('maxItems is smaller than minItems');
	}
	const count = Math.min(minimum, maximum ?? minimum);
	const itemSchema = items ?? true;
	return Array.from({ length: count }, () => build(itemSchema, depth + 1));
}

function objectFor(schema: JsonObject, depth: number): Record<string, unknown> {
	const properties = schema['properties'];
	const required = schema['required'];
	const result: Record<string, unknown> = {};
	if (!Array.isArray(required) || required.length === 0) {
		return result;
	}
	if (!isObject(properties)) {
		throw new Error('Required properties have no properties map');
	}
	for (const name of required) {
		if (typeof name !== 'string' || !Object.hasOwn(properties, name)) {
			throw new Error(`Required property ${String(name)} has no schema`);
		}
		Object.defineProperty(result, name, {
			value: build(properties[name], depth + 1),
			enumerable: true,
			configurable: true,
			writable: true,
		});
	}
	return result;
}

function build(schema: unknown, depth: number): unknown {
	if (depth > 64) {
		throw new Error('The schema is too deep');
	}
	if (schema === true) {
		return {};
	}
	if (schema === false) {
		throw new Error('A false schema has no valid payload');
	}
	if (!isObject(schema)) {
		throw new Error('The schema is not a JSON Schema');
	}
	if (schema['$ref'] !== undefined) {
		throw new Error('The schema has an unresolved reference');
	}
	if (schema['const'] !== undefined) {
		return clone(schema['const']);
	}
	const values = schema['enum'];
	if (Array.isArray(values) && values.length > 0) {
		return clone(values[0]);
	}
	if (
		schema['oneOf'] !== undefined ||
		schema['anyOf'] !== undefined ||
		schema['allOf'] !== undefined
	) {
		throw new Error('Composition is not supported by the minimal payload helper');
	}

	const type = typeOf(schema);
	if (type === 'object' || (type === undefined && schema['properties'] !== undefined)) {
		return objectFor(schema, depth);
	}
	if (type === 'array' || (type === undefined && schema['items'] !== undefined)) {
		return arrayFor(schema, depth);
	}
	if (type === 'string' || (type === undefined && schema['format'] !== undefined)) {
		return stringFor(schema);
	}
	if (type === 'integer' || type === 'number') {
		return numberFor(schema);
	}
	if (type === 'boolean') {
		return false;
	}
	if (type === 'null') {
		return null;
	}
	if (type !== undefined) {
		throw new Error(`Unsupported type ${type}`);
	}
	if (schema['default'] !== undefined) {
		return clone(schema['default']);
	}
	return {};
}

/**
 * Builds a minimal payload that should validate against a JSON Schema. It
 * normalizes drafts first and resolves local references, so tests can pass the
 * schema files as they are. Unsupported constructs fail loudly instead of
 * producing a payload that only appears valid.
 */
export function minimalPayload(schema: unknown): unknown {
	const normalized = normalizeSchema(schema, { stripUnknownKeywords: true });
	if (!normalized.ok) {
		throw new Error(normalized.error.message);
	}
	const resolved = resolveRefs(normalized.value.schema);
	if (!resolved.ok) {
		throw new Error(resolved.error.message);
	}
	const payload = build(resolved.value, 0);
	const validate = ajv.compile(resolved.value);
	if (!validate(payload)) {
		throw new Error(`The generated payload does not validate: ${JSON.stringify(validate.errors)}`);
	}
	return payload;
}
