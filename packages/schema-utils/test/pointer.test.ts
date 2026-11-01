// SPDX-License-Identifier: Apache-2.0
// SPDX-FileCopyrightText: 2026 Rodolfo Carrillo

import { describe, expect, it } from 'vitest';

import {
	formatJsonPointer,
	getByPointer,
	parseJsonPointer,
	parseLocalRef,
} from '../src/pointer.js';

describe('parseJsonPointer', () => {
	it('reads the empty pointer as the whole document', () => {
		expect(parseJsonPointer('')).toEqual({ ok: true, value: [] });
	});

	it('splits a pointer into segments', () => {
		expect(parseJsonPointer('/definitions/Name')).toEqual({
			ok: true,
			value: ['definitions', 'Name'],
		});
	});

	it('keeps empty segments', () => {
		expect(parseJsonPointer('/')).toEqual({ ok: true, value: [''] });
		expect(parseJsonPointer('//a')).toEqual({ ok: true, value: ['', 'a'] });
	});

	it('unescapes ~1 and ~0', () => {
		expect(parseJsonPointer('/a~1b/c~0d')).toEqual({ ok: true, value: ['a/b', 'c~d'] });
	});

	it('unescapes ~01 to ~1, not to a slash', () => {
		expect(parseJsonPointer('/~01')).toEqual({ ok: true, value: ['~1'] });
	});

	it('rejects a pointer that does not start with a slash', () => {
		const result = parseJsonPointer('definitions/Name');
		expect(result).toMatchObject({ ok: false, error: { kind: 'invalid-pointer' } });
	});

	it('rejects a tilde that is not followed by 0 or 1', () => {
		for (const pointer of ['/a~', '/a~2', '/~x/b']) {
			expect(parseJsonPointer(pointer)).toMatchObject({
				ok: false,
				error: { kind: 'invalid-pointer' },
			});
		}
	});
});

describe('formatJsonPointer', () => {
	it('returns the empty pointer for no segments', () => {
		expect(formatJsonPointer([])).toBe('');
	});

	it('escapes ~ and /', () => {
		expect(formatJsonPointer(['a/b', 'c~d', ''])).toBe('/a~1b/c~0d/');
	});

	it('round-trips through parseJsonPointer', () => {
		const segments = ['', '~', '/', '~1', '~0', 'a b', '%25'];
		expect(parseJsonPointer(formatJsonPointer(segments))).toEqual({ ok: true, value: segments });
	});
});

describe('parseLocalRef', () => {
	it('reads # as the root', () => {
		expect(parseLocalRef('#')).toEqual({ ok: true, value: [] });
	});

	it('reads a definitions reference', () => {
		expect(parseLocalRef('#/definitions/Name')).toEqual({
			ok: true,
			value: ['definitions', 'Name'],
		});
	});

	it('percent-decodes before reading the pointer', () => {
		expect(parseLocalRef('#/definitions/a%20b')).toEqual({
			ok: true,
			value: ['definitions', 'a b'],
		});
		expect(parseLocalRef('#/definitions/c%25d')).toEqual({
			ok: true,
			value: ['definitions', 'c%d'],
		});
	});

	it('treats a percent-encoded slash as a separator, as RFC 6901 does', () => {
		expect(parseLocalRef('#/a%2Fb')).toEqual({ ok: true, value: ['a', 'b'] });
		expect(parseLocalRef('#/a~1b')).toEqual({ ok: true, value: ['a/b'] });
	});

	it('rejects malformed percent-encoding', () => {
		expect(parseLocalRef('#/a%')).toMatchObject({ ok: false, error: { kind: 'invalid-pointer' } });
		expect(parseLocalRef('#/a%E0%A4%A')).toMatchObject({
			ok: false,
			error: { kind: 'invalid-pointer' },
		});
	});

	it('rejects an anchor', () => {
		expect(parseLocalRef('#foo')).toMatchObject({ ok: false, error: { kind: 'invalid-pointer' } });
	});

	it('reports a reference outside the document as external', () => {
		for (const ref of ['', 'other.json', 'other.json#/a', 'http://example.com/s#/a', 'urn:x:y']) {
			expect(parseLocalRef(ref)).toMatchObject({ ok: false, error: { kind: 'external-ref' } });
		}
	});
});

describe('getByPointer', () => {
	const document = {
		definitions: { Name: { type: 'string' } },
		list: [{ a: 1 }, 'second'],
		'a/b': 'slash',
		empty: null,
	};

	it('returns the document for no segments', () => {
		expect(getByPointer(document, [])).toEqual({ found: true, value: document });
	});

	it('follows properties', () => {
		expect(getByPointer(document, ['definitions', 'Name', 'type'])).toEqual({
			found: true,
			value: 'string',
		});
		expect(getByPointer(document, ['a/b'])).toEqual({ found: true, value: 'slash' });
	});

	it('finds a null value', () => {
		expect(getByPointer(document, ['empty'])).toEqual({ found: true, value: null });
	});

	it('follows array indexes', () => {
		expect(getByPointer(document, ['list', '0', 'a'])).toEqual({ found: true, value: 1 });
		expect(getByPointer(document, ['list', '1'])).toEqual({ found: true, value: 'second' });
	});

	it('does not find a missing property or an index out of range', () => {
		expect(getByPointer(document, ['missing'])).toEqual({ found: false });
		expect(getByPointer(document, ['list', '2'])).toEqual({ found: false });
	});

	it('does not accept an array segment that is not a canonical index', () => {
		for (const segment of ['01', '-', '-1', '1.0', 'length', '']) {
			expect(getByPointer(document, ['list', segment])).toEqual({ found: false });
		}
	});

	it('does not step into a primitive or null', () => {
		expect(getByPointer(document, ['definitions', 'Name', 'type', 'length'])).toEqual({
			found: false,
		});
		expect(getByPointer(document, ['empty', 'x'])).toEqual({ found: false });
	});

	it('does not reach the prototype chain', () => {
		for (const segment of ['toString', 'constructor', '__proto__', 'hasOwnProperty']) {
			expect(getByPointer(document, [segment])).toEqual({ found: false });
			expect(getByPointer(document, ['definitions', segment])).toEqual({ found: false });
		}
	});

	it('finds an own __proto__ property', () => {
		const parsed: unknown = JSON.parse('{"__proto__": {"x": 1}}');
		expect(getByPointer(parsed, ['__proto__', 'x'])).toEqual({ found: true, value: 1 });
	});
});
