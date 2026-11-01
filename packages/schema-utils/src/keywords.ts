// SPDX-License-Identifier: Apache-2.0
// SPDX-FileCopyrightText: 2026 Rodolfo Carrillo

import { defineData, isJsonObject } from './json.js';
import type { JsonObject, JsonValue, Path } from './types.js';

// Keywords whose value is one schema.
export const schemaKeywords: ReadonlySet<string> = new Set([
	'additionalItems',
	'additionalProperties',
	'contains',
	'else',
	'if',
	'not',
	'propertyNames',
	'then',
]);

// Keywords whose value is a list of schemas.
export const schemaListKeywords: ReadonlySet<string> = new Set(['allOf', 'anyOf', 'oneOf']);

// Keywords whose value is an object with schemas as values. The names are data.
export const schemaMapKeywords: ReadonlySet<string> = new Set([
	'definitions',
	'dependencies',
	'patternProperties',
	'properties',
]);

/**
 * Replaces the subschemas held by one keyword with what `visit` returns for
 * them, and returns the new value. A keyword that does not hold schemas, or
 * holds the wrong kind of value, is returned as it is. `items` holds one
 * schema or a list of them. Anything else, such as `enum` or `default`, is
 * data and is never visited.
 *
 * @param path The location of the schema that has the keyword.
 */
export function mapSchemaChildren(
	keyword: string,
	value: JsonValue,
	path: Path,
	visit: (child: JsonValue, path: Path) => JsonValue,
): JsonValue {
	const here = [...path, keyword];
	if (schemaKeywords.has(keyword)) {
		return visit(value, here);
	}
	if (keyword === 'items' || schemaListKeywords.has(keyword)) {
		if (Array.isArray(value)) {
			return value.map((item, index) => visit(item, [...here, index]));
		}
		return keyword === 'items' ? visit(value, here) : value;
	}
	if (schemaMapKeywords.has(keyword) && isJsonObject(value)) {
		const copy: JsonObject = {};
		for (const [name, entry] of Object.entries(value)) {
			defineData(copy, name, visit(entry, [...here, name]));
		}
		return copy;
	}
	return value;
}
