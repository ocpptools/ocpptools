// SPDX-License-Identifier: Apache-2.0
// SPDX-FileCopyrightText: 2026 Rodolfo Carrillo

// These JSON types match the ones in `@ocpptools/core` on purpose. This package
// does not depend on `core` (see ADR 0002), so the two must stay compatible.

/** A JSON primitive. */
export type JsonPrimitive = string | number | boolean | null;

/** Any value that survives a `JSON.stringify` and `JSON.parse` round trip. */
export type JsonValue = JsonPrimitive | JsonValue[] | { [key: string]: JsonValue };

/** A JSON object. */
export type JsonObject = { [key: string]: JsonValue };

/**
 * The outcome of a function that can fail because of its input. Check `ok`
 * before using `value`.
 */
export type Result<Value, Failure> =
	{ readonly ok: true; readonly value: Value } | { readonly ok: false; readonly error: Failure };

/**
 * One step into a value: a property name (`string`) or an array index
 * (`number`). A segment is never split or joined with dots, so a property
 * named `a.b` or `0` stays unambiguous.
 */
export type PathSegment = string | number;

/** A location inside a value, from its root. The empty path is the root. */
export type Path = readonly PathSegment[];

/** The values of the JSON Schema `type` keyword. */
export type JsonSchemaTypeName =
	'array' | 'boolean' | 'integer' | 'null' | 'number' | 'object' | 'string';

/**
 * The keywords of a JSON Schema object, as written in draft-04, draft-06, or
 * draft-07, with `Child` as the type of its subschemas. It names the keywords
 * this package reads. Any other keyword is allowed and is kept as it is.
 *
 * Fields that changed between drafts list both forms: `id` (draft-04) and
 * `$id`, and a boolean (draft-04) or numeric `exclusiveMinimum` and
 * `exclusiveMaximum`.
 */
export interface JsonSchemaKeywords<Child> {
	readonly $schema?: string;
	readonly $id?: string;
	/** The draft-04 spelling of `$id`. */
	readonly id?: string;
	readonly $ref?: string;
	readonly type?: JsonSchemaTypeName | readonly JsonSchemaTypeName[];
	readonly properties?: { readonly [name: string]: Child };
	readonly required?: readonly string[];
	readonly items?: Child | readonly Child[];
	readonly additionalItems?: Child;
	readonly additionalProperties?: Child;
	readonly definitions?: { readonly [name: string]: Child };
	readonly enum?: readonly JsonValue[];
	readonly default?: JsonValue;
	readonly description?: string;
	readonly format?: string;
	readonly minLength?: number;
	readonly maxLength?: number;
	readonly minimum?: number;
	readonly maximum?: number;
	readonly exclusiveMinimum?: number | boolean;
	readonly exclusiveMaximum?: number | boolean;
	readonly multipleOf?: number;
	readonly minItems?: number;
	readonly maxItems?: number;
	readonly allOf?: readonly Child[];
	readonly anyOf?: readonly Child[];
	readonly oneOf?: readonly Child[];
	readonly not?: Child;
	readonly [keyword: string]: unknown;
}

/** A JSON Schema object. It may contain `$ref`. */
export type JsonSchemaObject = JsonSchemaKeywords<JsonSchema>;

/** A JSON Schema. A boolean is a valid schema from draft-06 on. */
export type JsonSchema = JsonSchemaObject | boolean;

/** A JSON Schema object with no `$ref` in any subschema. */
export type ResolvedJsonSchemaObject = JsonSchemaKeywords<ResolvedJsonSchema> & {
	readonly $ref?: never;
};

/** The result of `resolveRefs`: a JSON Schema with every `$ref` replaced. */
export type ResolvedJsonSchema = ResolvedJsonSchemaObject | boolean;
