// SPDX-License-Identifier: Apache-2.0
// SPDX-FileCopyrightText: 2026 Rodolfo Carrillo

import type { JsonObject, JsonValue } from '@ocpptools/core';
import type { Path, ResolvedJsonSchema } from '@ocpptools/schema-utils';
import { applyDefaults, createEmptyPayload } from '@ocpptools/schema-utils';

import { issue, limitExceeded, messageOf, warning } from './errors.js';
import { cloneJson, type JsonLimits } from './json.js';
import type { SchemaLoader } from './schema.js';
import type {
	BuilderIssue,
	BuilderResult,
	BuilderWarning,
	BuildPayloadOptions,
	EmptyPayloadOptions,
	PayloadKind,
} from './types.js';

const DEFAULT_LIMITS: JsonLimits = { maxDepth: 64, maxNodes: 10_000 };

interface CheckState {
	readonly limits: JsonLimits;
	readonly warnings: BuilderWarning[];
	nodes: number;
}

function isRecord(value: unknown): value is Record<string, unknown> {
	return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function hasOwn(value: object, key: string): boolean {
	return Object.hasOwn(value, key);
}

function asSchema(value: unknown): ResolvedJsonSchema {
	return value as ResolvedJsonSchema;
}

function allowsObjectRoot(schema: ResolvedJsonSchema): boolean {
	if (schema === true) return true;
	if (schema === false) return false;
	const type = schema.type;
	if (type !== undefined) {
		const types = Array.isArray(type) ? type : [type];
		if (!types.includes('object')) return false;
	}
	if (hasOwn(schema, 'const') && !isRecord(schema.const)) return false;
	if (Array.isArray(schema.enum) && !schema.enum.some((entry) => isRecord(entry))) return false;
	return true;
}

function matchesType(value: unknown, type: string): boolean {
	switch (type) {
		case 'null':
			return value === null;
		case 'boolean':
			return typeof value === 'boolean';
		case 'string':
			return typeof value === 'string';
		case 'number':
			return typeof value === 'number' && Number.isFinite(value);
		case 'integer':
			return typeof value === 'number' && Number.isInteger(value);
		case 'array':
			return Array.isArray(value);
		case 'object':
			return isRecord(value);
		default:
			return false;
	}
}

function jsonEqual(left: unknown, right: unknown): boolean {
	if (left === right) return true;
	if (Array.isArray(left) && Array.isArray(right)) {
		return (
			left.length === right.length && left.every((entry, index) => jsonEqual(entry, right[index]))
		);
	}
	if (isRecord(left) && isRecord(right)) {
		const leftKeys = Object.keys(left);
		const rightKeys = Object.keys(right);
		return (
			leftKeys.length === rightKeys.length &&
			leftKeys.every((key) => hasOwn(right, key) && jsonEqual(left[key], right[key]))
		);
	}
	return false;
}

function error(
	code: BuilderIssue['code'],
	path: Path,
	message: string,
	expected?: string,
	received?: unknown,
): BuilderIssue {
	return issue('payload', code, path, message, expected, received);
}

function checkValue(
	schema: ResolvedJsonSchema,
	value: unknown,
	path: Path,
	depth: number,
	state: CheckState,
): BuilderIssue | undefined {
	state.nodes += 1;
	if (state.nodes > state.limits.maxNodes) {
		return limitExceeded(path, 'The payload exceeds the configured node limit');
	}
	if (depth > state.limits.maxDepth) {
		return limitExceeded(path, 'The payload exceeds the configured depth limit');
	}
	if (schema === true) return undefined;
	if (schema === false) {
		return error('invalid-payload', path, 'The schema does not allow a value');
	}
	if (!isRecord(schema)) {
		return issue('schema', 'schema-invalid', path, 'The schema is not a JSON Schema');
	}
	if (
		Array.isArray(schema.allOf) ||
		Array.isArray(schema.anyOf) ||
		Array.isArray(schema.oneOf) ||
		schema.not !== undefined
	) {
		state.warnings.push(
			warning(
				'payload',
				'unsupported-keyword',
				path,
				'Composition keywords are not checked by the builder; use @ocpptools/validator',
			),
		);
	}
	const type = schema.type;
	if (type !== undefined) {
		const types: readonly string[] = Array.isArray(type)
			? (type as readonly string[])
			: [type as string];
		if (types.length === 0 || !types.some((entry) => matchesType(value, entry))) {
			return error(
				'invalid-type',
				path,
				`The value must be ${types.join(' or ')}`,
				types.join(' or '),
				value,
			);
		}
	}
	if (Array.isArray(schema.enum)) {
		if (schema.enum.length === 0 || !schema.enum.some((entry) => jsonEqual(entry, value))) {
			return error(
				'invalid-enum',
				path,
				'The value is not one of the allowed enum values',
				'an enum value',
				value,
			);
		}
	}
	if (hasOwn(schema, 'const') && !jsonEqual(schema.const, value)) {
		return error(
			'invalid-enum',
			path,
			'The value does not match the const value',
			'the const value',
			value,
		);
	}

	if (isRecord(value)) {
		const required = schema.required;
		if (Array.isArray(required)) {
			for (const name of required) {
				if (typeof name === 'string' && !hasOwn(value, name)) {
					return error(
						'missing-required',
						[...path, name],
						`Missing required property ${name}`,
						'present',
						'missing',
					);
				}
			}
		}
		const properties = schema.properties;
		if (isRecord(properties)) {
			for (const [name, child] of Object.entries(properties)) {
				if (!hasOwn(value, name)) continue;
				const childIssue = checkValue(
					asSchema(child),
					value[name],
					[...path, name],
					depth + 1,
					state,
				);
				if (childIssue !== undefined) return childIssue;
			}
		}
		const minProperties = schema['minProperties'];
		if (typeof minProperties === 'number' && Object.keys(value).length < minProperties) {
			return error(
				'out-of-range',
				path,
				`At least ${String(minProperties)} properties are required`,
			);
		}
		const maxProperties = schema['maxProperties'];
		if (typeof maxProperties === 'number' && Object.keys(value).length > maxProperties) {
			return error('out-of-range', path, `At most ${String(maxProperties)} properties are allowed`);
		}
	}

	if (Array.isArray(value)) {
		const minItems = schema.minItems;
		if (typeof minItems === 'number' && value.length < minItems) {
			return error('out-of-range', path, `At least ${String(minItems)} items are required`);
		}
		const maxItems = schema.maxItems;
		if (typeof maxItems === 'number' && value.length > maxItems) {
			return error('out-of-range', path, `At most ${String(maxItems)} items are allowed`);
		}
		const items = schema.items;
		if (Array.isArray(items)) {
			for (let index = 0; index < Math.min(items.length, value.length); index += 1) {
				const childIssue = checkValue(
					items[index] as ResolvedJsonSchema,
					value[index],
					[...path, index],
					depth + 1,
					state,
				);
				if (childIssue !== undefined) return childIssue;
			}
			if (value.length > items.length) {
				if (schema.additionalItems === false) {
					return error(
						'invalid-payload',
						[...path, items.length],
						'Additional array items are not allowed',
					);
				}
				if (schema.additionalItems !== undefined && schema.additionalItems !== true) {
					for (let index = items.length; index < value.length; index += 1) {
						const childIssue = checkValue(
							schema.additionalItems,
							value[index],
							[...path, index],
							depth + 1,
							state,
						);
						if (childIssue !== undefined) return childIssue;
					}
				}
			}
		} else if (items !== undefined) {
			for (let index = 0; index < value.length; index += 1) {
				const childIssue = checkValue(
					items as ResolvedJsonSchema,
					value[index],
					[...path, index],
					depth + 1,
					state,
				);
				if (childIssue !== undefined) return childIssue;
			}
		}
		if (schema.uniqueItems === true) {
			for (let index = 0; index < value.length; index += 1) {
				for (let other = index + 1; other < value.length; other += 1) {
					if (jsonEqual(value[index], value[other])) {
						return error(
							'invalid-payload',
							[...path, other],
							'Array items must be unique',
							'unique items',
							value[other],
						);
					}
				}
			}
		}
	}

	if (typeof value === 'string') {
		const length = Array.from(value).length;
		if (typeof schema.minLength === 'number' && length < schema.minLength) {
			return error(
				'too-short',
				path,
				`The string must have at least ${String(schema.minLength)} characters`,
			);
		}
		if (typeof schema.maxLength === 'number' && length > schema.maxLength) {
			return error(
				'too-long',
				path,
				`The string must have at most ${String(schema.maxLength)} characters`,
			);
		}
	}

	if (typeof value === 'number') {
		if (typeof schema.minimum === 'number' && value < schema.minimum) {
			return error('out-of-range', path, `The value must be at least ${String(schema.minimum)}`);
		}
		if (typeof schema.maximum === 'number' && value > schema.maximum) {
			return error('out-of-range', path, `The value must be at most ${String(schema.maximum)}`);
		}
		if (typeof schema.exclusiveMinimum === 'number' && value <= schema.exclusiveMinimum) {
			return error(
				'out-of-range',
				path,
				`The value must be greater than ${String(schema.exclusiveMinimum)}`,
			);
		}
		if (typeof schema.exclusiveMaximum === 'number' && value >= schema.exclusiveMaximum) {
			return error(
				'out-of-range',
				path,
				`The value must be less than ${String(schema.exclusiveMaximum)}`,
			);
		}
		if (typeof schema.multipleOf === 'number' && schema.multipleOf > 0) {
			const quotient = value / schema.multipleOf;
			if (Math.abs(quotient - Math.round(quotient)) > 1e-9) {
				return error(
					'out-of-range',
					path,
					`The value must be a multiple of ${String(schema.multipleOf)}`,
				);
			}
		}
	}
	return undefined;
}

function checkJsonObject(value: unknown, limits: JsonLimits): BuilderResult<JsonObject> {
	const cloned = cloneJson(value, limits);
	if (!cloned.ok) return { ok: false, error: cloned.error, warnings: [] };
	if (!isRecord(cloned.value)) {
		return {
			ok: false,
			error: error('invalid-payload', [], 'The payload must be a JSON object', 'object', value),
			warnings: [],
		};
	}
	return { ok: true, value: cloned.value, warnings: [] };
}

export async function emptyPayloadFor(
	loader: SchemaLoader,
	action: string,
	options: EmptyPayloadOptions = {},
	limits: JsonLimits = DEFAULT_LIMITS,
): Promise<BuilderResult<JsonObject>> {
	const kind: PayloadKind = options.kind ?? 'request';
	const loaded = await loader.load(action, kind);
	if (!loaded.ok) return loaded;
	const schema = loaded.value.schema;
	if (schema === false) {
		return {
			ok: false,
			error: error('invalid-payload', [], 'The schema does not allow a payload'),
			warnings: loaded.warnings,
		};
	}
	if (schema === true) {
		return { ok: true, value: {}, warnings: loaded.warnings };
	}
	if (!allowsObjectRoot(schema)) {
		return {
			ok: false,
			error: error('invalid-payload', [], 'The root schema must describe a JSON object'),
			warnings: loaded.warnings,
		};
	}
	let empty: JsonValue | undefined;
	try {
		empty = createEmptyPayload(schema, { fill: options.fill });
	} catch (err) {
		return {
			ok: false,
			error: error('invalid-payload', [], messageOf(err, 'The empty payload failed')),
			warnings: loaded.warnings,
		};
	}
	const value = empty === undefined ? {} : empty;
	const checked = checkJsonObject(value, limits);
	if (!checked.ok) return { ...checked, warnings: loaded.warnings };
	return { ok: true, value: checked.value, warnings: loaded.warnings };
}

export async function buildPayloadFor(
	loader: SchemaLoader,
	action: string,
	input: unknown,
	options: BuildPayloadOptions = {},
	limits: JsonLimits = DEFAULT_LIMITS,
): Promise<BuilderResult<JsonObject>> {
	const kind: PayloadKind = options.kind ?? 'request';
	const loaded = await loader.load(action, kind);
	if (!loaded.ok) return loaded;
	const cloned = checkJsonObject(input, limits);
	if (!cloned.ok) return { ...cloned, warnings: loaded.warnings };
	let value: JsonValue = cloned.value;
	let applyDefaultsOption: boolean;
	try {
		applyDefaultsOption = options.applyDefaults !== false;
	} catch (err) {
		return {
			ok: false,
			error: error('invalid-payload', [], messageOf(err, 'The build options could not be read')),
			warnings: loaded.warnings,
		};
	}
	if (applyDefaultsOption) {
		let defaulted;
		try {
			defaulted = applyDefaults(loaded.value.schema, value);
		} catch (err) {
			return {
				ok: false,
				error: error('invalid-payload', [], messageOf(err, 'Defaults could not be applied')),
				warnings: loaded.warnings,
			};
		}
		if (!defaulted.ok) {
			return {
				ok: false,
				error: error('invalid-payload', defaulted.error.path, defaulted.error.message),
				warnings: loaded.warnings,
			};
		}
		value = defaulted.value;
	}
	const bounded = checkJsonObject(value, limits);
	if (!bounded.ok) return { ...bounded, warnings: loaded.warnings };
	const state: CheckState = { limits, warnings: [], nodes: 0 };
	const checked = checkValue(loaded.value.schema, bounded.value, [], 0, state);
	if (checked !== undefined) {
		return { ok: false, error: checked, warnings: [...loaded.warnings, ...state.warnings] };
	}
	return {
		ok: true,
		value: bounded.value,
		warnings: [...loaded.warnings, ...state.warnings],
	};
}
