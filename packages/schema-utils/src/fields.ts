// SPDX-License-Identifier: Apache-2.0
// SPDX-FileCopyrightText: 2026 Rodolfo Carrillo

import { cloneJson } from './clone.js';
import type { JsonValue, Path, ResolvedJsonSchema } from './types.js';

/** The deepest nesting `getFields` follows. Anything below it is `unsupported`. */
export const MAX_FIELD_DEPTH = 256;

/** The type of a field: a JSON Schema type, `any` when it is not constrained, or `unsupported`. */
export type FieldKind =
	'array' | 'boolean' | 'integer' | 'null' | 'number' | 'object' | 'string' | 'any' | 'unsupported';

/**
 * Why a field is `unsupported`:
 *
 * - `composition`: it uses `allOf`, `anyOf`, or `oneOf`.
 * - `multiple-types`: its `type` lists several types besides `null`.
 * - `unknown-type`: its `type` names something that is not a JSON Schema type.
 * - `never`: it is the schema `false`, which nothing satisfies.
 * - `invalid`: it is not a schema (not an object and not a boolean).
 * - `too-deep`: it is nested deeper than `MAX_FIELD_DEPTH`.
 */
export type UnsupportedReason =
	'composition' | 'multiple-types' | 'unknown-type' | 'never' | 'invalid' | 'too-deep';

/** One field of a schema, and the fields inside it. */
export interface Field {
	/**
	 * Where the field is, from the root: a property name for an object property
	 * and an index for an array element. The path of an element of a list of
	 * identical items (`items` as a schema) ends in `0` and stands for every
	 * element. The root has an empty path.
	 */
	readonly path: Path;
	/** The property name, for an object property. */
	readonly name?: string;
	/** Whether the parent object lists this property in `required`. */
	readonly required: boolean;
	readonly kind: FieldKind;
	/** Why `kind` is `unsupported`. */
	readonly reason?: UnsupportedReason;
	/** Whether `kind` was worked out because the schema has no `type`. */
	readonly inferred: boolean;
	/** Whether `type` also allows `null`, as in `["string", "null"]`. */
	readonly nullable: boolean;
	/** The description as written. */
	readonly description?: string;
	readonly format?: string;
	readonly pattern?: string;
	/** The allowed values, with their JSON types kept (a number stays a number). */
	readonly enum?: readonly JsonValue[];
	readonly default?: JsonValue;
	readonly minLength?: number;
	readonly maxLength?: number;
	readonly minimum?: number;
	readonly maximum?: number;
	readonly exclusiveMinimum?: number;
	readonly exclusiveMaximum?: number;
	readonly multipleOf?: number;
	readonly minItems?: number;
	readonly maxItems?: number;
	/** The properties of an `object`, in schema order. Empty when it declares none. */
	readonly children?: readonly Field[];
	/** The element of an `array` whose `items` is one schema. */
	readonly item?: Field;
	/** The elements of an `array` whose `items` is a list of schemas, by position. */
	readonly tuple?: readonly Field[];
}

export interface GetFieldsOptions {
	/**
	 * Called for each object property with its path. Return `true` to leave the
	 * property out, for example to hide a field the caller does not want to show.
	 */
	readonly omit?: (path: Path) => boolean;
}

type UnknownRecord = Readonly<Record<string, unknown>>;
type NumericKey =
	| 'minLength'
	| 'maxLength'
	| 'minimum'
	| 'maximum'
	| 'exclusiveMinimum'
	| 'exclusiveMaximum'
	| 'multipleOf'
	| 'minItems'
	| 'maxItems';
type Kinds = Pick<Field, 'kind' | 'reason' | 'inferred' | 'nullable'>;

const typeNames: ReadonlySet<unknown> = new Set([
	'array',
	'boolean',
	'integer',
	'null',
	'number',
	'object',
	'string',
]);
const numericKeys: readonly NumericKey[] = [
	'minLength',
	'maxLength',
	'minimum',
	'maximum',
	'exclusiveMinimum',
	'exclusiveMaximum',
	'multipleOf',
	'minItems',
	'maxItems',
];

function asRecord(value: unknown): UnknownRecord | undefined {
	return typeof value === 'object' && value !== null && !Array.isArray(value)
		? (value as UnknownRecord)
		: undefined;
}

function own(record: UnknownRecord, key: string): unknown {
	return Object.hasOwn(record, key) ? record[key] : undefined;
}

function ownString(record: UnknownRecord, key: string): string | undefined {
	const value = own(record, key);
	return typeof value === 'string' ? value : undefined;
}

function ownJson(record: UnknownRecord, key: string): JsonValue | undefined {
	if (!Object.hasOwn(record, key)) {
		return undefined;
	}
	const copy = cloneJson(record[key]);
	return copy.ok ? copy.value : undefined;
}

/** The JSON Schema type of a value, with whole numbers as `integer`. */
function valueKind(value: unknown): FieldKind | undefined {
	if (value === null) {
		return 'null';
	}
	if (typeof value === 'string') {
		return 'string';
	}
	if (typeof value === 'boolean') {
		return 'boolean';
	}
	if (typeof value === 'number') {
		return Number.isInteger(value) ? 'integer' : 'number';
	}
	return undefined;
}

function inferKind(record: UnknownRecord): Kinds {
	const none: Kinds = { kind: 'any', inferred: false, nullable: false };
	if (asRecord(own(record, 'properties')) !== undefined) {
		return { kind: 'object', inferred: true, nullable: false };
	}
	if (own(record, 'items') !== undefined) {
		return { kind: 'array', inferred: true, nullable: false };
	}
	const values = own(record, 'enum');
	if (!Array.isArray(values) || values.length === 0) {
		return none;
	}
	const kinds = new Set(values.map(valueKind));
	const [only] = kinds;
	// Whole numbers and fractions in one enum are both `number`.
	if (kinds.size === 2 && kinds.has('integer') && kinds.has('number')) {
		return { kind: 'number', inferred: true, nullable: false };
	}
	return kinds.size === 1 && only !== undefined
		? { kind: only, inferred: true, nullable: false }
		: none;
}

function typeKind(record: UnknownRecord): Kinds {
	const type = own(record, 'type');
	const names: unknown[] = Array.isArray(type) ? (type as unknown[]) : [type];
	if (type === undefined || names.length === 0) {
		return inferKind(record);
	}
	if (!names.every((name) => typeNames.has(name))) {
		return { kind: 'unsupported', reason: 'unknown-type', inferred: false, nullable: false };
	}
	const others = [...new Set(names)].filter((name) => name !== 'null');
	if (others.length > 1) {
		return { kind: 'unsupported', reason: 'multiple-types', inferred: false, nullable: false };
	}
	const [other] = others;
	if (other === undefined) {
		return { kind: 'null', inferred: false, nullable: false };
	}
	return { kind: other as FieldKind, inferred: false, nullable: names.includes('null') };
}

function describeField(
	schema: unknown,
	path: Path,
	name: string | undefined,
	required: boolean,
	options: GetFieldsOptions,
	depth: number,
): Field {
	const base = { path, required, inferred: false, nullable: false };
	const unsupported = (reason: UnsupportedReason): Field => ({
		...base,
		kind: 'unsupported',
		reason,
	});
	if (typeof schema === 'boolean') {
		return schema ? { ...base, kind: 'any' } : unsupported('never');
	}
	const record = asRecord(schema);
	if (record === undefined) {
		return unsupported('invalid');
	}
	if (depth > MAX_FIELD_DEPTH) {
		return unsupported('too-deep');
	}
	const composed = ['allOf', 'anyOf', 'oneOf'].some((keyword) =>
		Array.isArray(own(record, keyword)),
	);
	const kinds: Kinds = composed
		? { kind: 'unsupported', reason: 'composition', inferred: false, nullable: false }
		: typeKind(record);

	const numbers: { -readonly [Key in NumericKey]?: number } = {};
	for (const key of numericKeys) {
		const value = own(record, key);
		if (typeof value === 'number' && Number.isFinite(value)) {
			numbers[key] = value;
		}
	}
	const values = ownJson(record, 'enum');
	const fallback = ownJson(record, 'default');
	const description = ownString(record, 'description');
	const format = ownString(record, 'format');
	const pattern = ownString(record, 'pattern');
	const field: Field = {
		path,
		...(name === undefined ? {} : { name }),
		required,
		...kinds,
		...(description === undefined ? {} : { description }),
		...(format === undefined ? {} : { format }),
		...(pattern === undefined ? {} : { pattern }),
		...(Array.isArray(values) ? { enum: values } : {}),
		...(fallback === undefined ? {} : { default: fallback }),
		...numbers,
	};
	const next = depth + 1;
	if (kinds.kind === 'object') {
		const properties = asRecord(own(record, 'properties')) ?? {};
		const requiredNames = own(record, 'required');
		const requiredSet = new Set(Array.isArray(requiredNames) ? (requiredNames as unknown[]) : []);
		const children: Field[] = [];
		for (const [propertyName, property] of Object.entries(properties)) {
			const propertyPath = [...path, propertyName];
			if (options.omit?.(propertyPath) === true) {
				continue;
			}
			children.push(
				describeField(
					property,
					propertyPath,
					propertyName,
					requiredSet.has(propertyName),
					options,
					next,
				),
			);
		}
		return { ...field, children };
	}
	if (kinds.kind === 'array') {
		const items = own(record, 'items');
		if (Array.isArray(items)) {
			const tuple = (items as unknown[]).map((entry, index) =>
				describeField(entry, [...path, index], undefined, false, options, next),
			);
			return { ...field, tuple };
		}
		if (items !== undefined) {
			return {
				...field,
				item: describeField(items, [...path, 0], undefined, false, options, next),
			};
		}
	}
	return field;
}

/**
 * Describes a schema as a tree of fields, for building a form or a payload. It
 * takes a schema from `resolveRefs`, so there is nothing left to follow. It
 * does not throw, and it does not change the schema: values such as `enum` and
 * `default` are copies.
 *
 * Properties come in the order JavaScript gives them, which is the order of the
 * schema except that names such as `"0"` and `"12"`, which look like array
 * indexes, come first.
 *
 * A field with no `type` gets one from its `properties` (object), `items`
 * (array), or `enum` values, and `inferred` is `true`. A field that uses
 * `allOf`, `anyOf`, or `oneOf`, or whose type cannot be one kind, is
 * `unsupported` and has no children, so nothing is guessed. Text such as
 * `description` is returned as written.
 */
export function getFields(schema: ResolvedJsonSchema, options: GetFieldsOptions = {}): Field {
	return describeField(schema, [], undefined, false, options, 0);
}
