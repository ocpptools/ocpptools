// SPDX-License-Identifier: Apache-2.0
// SPDX-FileCopyrightText: 2026 Rodolfo Carrillo

import type { JsonObject, JsonValue } from './types.js';

/** Whether a JSON value is an object, as opposed to an array or a primitive. */
export function isJsonObject(value: unknown): value is JsonObject {
	return typeof value === 'object' && value !== null && !Array.isArray(value);
}

/**
 * Sets an own, enumerable property. A plain assignment of `__proto__` would
 * change the prototype of `target` instead of adding a property.
 */
export function defineData(target: JsonObject, key: string, value: JsonValue): void {
	Object.defineProperty(target, key, {
		value,
		writable: true,
		enumerable: true,
		configurable: true,
	});
}

/** Reads an own property, and never reaches the prototype chain. */
export function ownValue(source: JsonObject, key: string): JsonValue | undefined {
	return Object.hasOwn(source, key) ? source[key] : undefined;
}
