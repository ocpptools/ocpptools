// SPDX-License-Identifier: Apache-2.0
// SPDX-FileCopyrightText: 2026 Rodolfo Carrillo

import { describe, expect, it } from 'vitest';

import { compareWithManifest, sameBytes } from '../lib/verbatim-schemas.mjs';

const expected = { '1.6/A.json': 'aaa', '2.0.1/B.json': 'bbb' };

describe('compareWithManifest', () => {
	it('accepts files that match the manifest', () => {
		const actual = new Map([
			['1.6/A.json', 'aaa'],
			['2.0.1/B.json', 'bbb'],
		]);
		expect(compareWithManifest(expected, actual)).toEqual([]);
	});

	it('reports a file whose bytes changed', () => {
		const actual = new Map([
			['1.6/A.json', 'changed'],
			['2.0.1/B.json', 'bbb'],
		]);
		expect(compareWithManifest(expected, actual)).toEqual([
			{ path: '1.6/A.json', problem: 'modified', expected: 'aaa', actual: 'changed' },
		]);
	});

	it('reports a file that is missing', () => {
		const actual = new Map([['2.0.1/B.json', 'bbb']]);
		expect(compareWithManifest(expected, actual)).toEqual([
			{ path: '1.6/A.json', problem: 'missing', expected: 'aaa' },
		]);
	});

	it('reports a file that is not in the manifest', () => {
		const actual = new Map([
			['1.6/A.json', 'aaa'],
			['2.0.1/B.json', 'bbb'],
			['2.0.1/Extra.json', 'ccc'],
		]);
		expect(compareWithManifest(expected, actual)).toEqual([
			{ path: '2.0.1/Extra.json', problem: 'unlisted' },
		]);
	});

	it('does not treat a path like a property of Object', () => {
		const actual = new Map([['toString', 'x']]);
		expect(compareWithManifest({}, actual)).toEqual([{ path: 'toString', problem: 'unlisted' }]);
	});
});

describe('sameBytes', () => {
	it('compares bytes', () => {
		expect(sameBytes(Uint8Array.of(1, 2, 3), Uint8Array.of(1, 2, 3))).toBe(true);
		expect(sameBytes(Uint8Array.of(1, 2, 3), Uint8Array.of(1, 2, 4))).toBe(false);
		expect(sameBytes(Uint8Array.of(1, 2), Uint8Array.of(1, 2, 3))).toBe(false);
		expect(sameBytes(new Uint8Array(), new Uint8Array())).toBe(true);
	});
});
