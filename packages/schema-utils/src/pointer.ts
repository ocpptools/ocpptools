// SPDX-License-Identifier: Apache-2.0
// SPDX-FileCopyrightText: 2026 Rodolfo Carrillo

import type { Result } from './types.js';

/**
 * Why a reference could not be turned into a path:
 *
 * - `invalid-pointer`: the JSON pointer or its percent-encoding is malformed,
 *   or the reference is an anchor such as `#foo`, which is not supported.
 * - `external-ref`: the reference points outside the document.
 */
export type PointerErrorKind = 'invalid-pointer' | 'external-ref';

export interface PointerError {
	readonly kind: PointerErrorKind;
	readonly message: string;
}

/** The outcome of reading a value at a pointer. */
export type Lookup = { readonly found: true; readonly value: unknown } | { readonly found: false };

const notFound: Lookup = { found: false };
const badEscape = /~(?![01])/;
const arrayIndex = /^(?:0|[1-9]\d*)$/;

function fail(kind: PointerErrorKind, message: string): Result<never, PointerError> {
	return { ok: false, error: { kind, message } };
}

/**
 * Parses a JSON pointer (RFC 6901) into its unescaped segments. The empty
 * string is the whole document. Any other pointer starts with `/`.
 */
export function parseJsonPointer(pointer: string): Result<readonly string[], PointerError> {
	if (pointer === '') {
		return { ok: true, value: [] };
	}
	if (!pointer.startsWith('/')) {
		return fail('invalid-pointer', `A JSON pointer must be empty or start with "/": ${pointer}`);
	}
	const encoded = pointer.slice(1).split('/');
	if (encoded.some((segment) => badEscape.test(segment))) {
		return fail('invalid-pointer', `A "~" must be followed by 0 or 1: ${pointer}`);
	}
	// "~1" first, so that "~01" becomes "~1" and not "/".
	const value = encoded.map((segment) => segment.replaceAll('~1', '/').replaceAll('~0', '~'));
	return { ok: true, value };
}

/** Builds the JSON pointer for a list of segments. The reverse of `parseJsonPointer`. */
export function formatJsonPointer(segments: readonly string[]): string {
	return segments
		.map((segment) => `/${segment.replaceAll('~', '~0').replaceAll('/', '~1')}`)
		.join('');
}

/**
 * Parses a same-document `$ref` such as `#` or `#/definitions/Name` into
 * segments. The part after `#` is percent-decoded first, then read as a JSON
 * pointer. A reference that does not start with `#` is external.
 */
export function parseLocalRef(ref: string): Result<readonly string[], PointerError> {
	if (!ref.startsWith('#')) {
		return fail('external-ref', `Only same-document references are supported: ${ref}`);
	}
	let pointer: string;
	try {
		pointer = decodeURIComponent(ref.slice(1));
	} catch {
		return fail('invalid-pointer', `Malformed percent-encoding in reference: ${ref}`);
	}
	return parseJsonPointer(pointer);
}

/**
 * Reads the value at `segments`. Only own properties are followed, so a
 * segment such as `toString` or `__proto__` does not reach the prototype chain.
 * An array segment must be a canonical index.
 */
export function getByPointer(document: unknown, segments: readonly string[]): Lookup {
	let current = document;
	for (const segment of segments) {
		if (Array.isArray(current)) {
			if (!arrayIndex.test(segment)) {
				return notFound;
			}
			const index = Number(segment);
			if (index >= current.length) {
				return notFound;
			}
			const item: unknown = current[index];
			current = item;
		} else if (typeof current === 'object' && current !== null && Object.hasOwn(current, segment)) {
			current = (current as Record<string, unknown>)[segment];
		} else {
			return notFound;
		}
	}
	return { found: true, value: current };
}
