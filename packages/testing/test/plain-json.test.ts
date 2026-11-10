// SPDX-License-Identifier: Apache-2.0
// SPDX-FileCopyrightText: 2026 Rodolfo Carrillo

import { describe, expect, it } from 'vitest';

import { assertPlainJson, isPlainJsonObject, PlainJsonError } from '../src/plain-json.js';

function expectInvalid(value: unknown): void {
	expect(() => assertPlainJson(value)).toThrow(PlainJsonError);
}

describe('plain JSON guard', () => {
	it('accepts primitives, arrays, plain objects, null prototypes and shared DAGs', () => {
		const shared = { value: 1 };
		expect(() =>
			assertPlainJson({
				null: null,
				text: 'x',
				number: 1.5,
				boolean: true,
				array: [1, 'x', null, shared],
				shared,
				nullProto: Object.assign(Object.create(null) as Record<string, unknown>, {
					value: 2,
				}),
			}),
		).not.toThrow();
		expect(isPlainJsonObject({})).toBe(true);
		expect(isPlainJsonObject(Object.create(null) as object)).toBe(true);
		expect(isPlainJsonObject([])).toBe(false);
		expect(isPlainJsonObject(null)).toBe(false);
		expect(isPlainJsonObject(new Date())).toBe(false);
		expect(isPlainJsonObject(new Map())).toBe(false);
	});

	it('rejects values JSON cannot represent', () => {
		expectInvalid(undefined);
		expectInvalid(() => undefined);
		expectInvalid(Symbol('x'));
		expectInvalid(1n);
		expectInvalid(Number.NaN);
		expectInvalid(Number.POSITIVE_INFINITY);
		expectInvalid(new Date());
		expectInvalid(new Map());
		expectInvalid(new String('x'));
		expectInvalid(Object.create({ inherited: true }));
	});

	it('rejects cycles but accepts a repeated acyclic object', () => {
		const cycle: Record<string, unknown> = {};
		cycle['self'] = cycle;
		expectInvalid(cycle);
		const shared = { value: 1 };
		expect(() => assertPlainJson([shared, shared])).not.toThrow();
	});

	it('rejects sparse arrays and extra array properties', () => {
		const sparse = new Array(2);
		sparse[0] = 1;
		expectInvalid(sparse);
		const extra = [1, 2] as unknown[] & { extra?: number };
		extra.extra = 3;
		expectInvalid(extra);
	});

	it('rejects symbol keys, accessors and non-enumerable properties without invoking getters', () => {
		const symbolKey = { value: 1 };
		Object.defineProperty(symbolKey, Symbol('hidden'), { value: 2 });
		expectInvalid(symbolKey);

		const symbolArray = [1] as unknown[];
		Object.defineProperty(symbolArray, Symbol('hidden'), { value: 2 });
		expectInvalid(symbolArray);

		const accessorArray = [1] as unknown[];
		Object.defineProperty(accessorArray, '0', {
			enumerable: true,
			get: () => 1,
		});
		expectInvalid(accessorArray);

		const hiddenArray = [1] as unknown[];
		Object.defineProperty(hiddenArray, '0', {
			enumerable: false,
			value: 1,
		});
		expectInvalid(hiddenArray);

		let invoked = false;
		const accessor = {};
		Object.defineProperty(accessor, 'value', {
			enumerable: true,
			get() {
				invoked = true;
				return 1;
			},
		});
		expectInvalid(accessor);
		expect(invoked).toBe(false);

		const hidden = {};
		Object.defineProperty(hidden, 'toJSON', {
			enumerable: false,
			value: () => ({ changed: true }),
		});
		expectInvalid(hidden);
	});

	it('accepts an own __proto__ data property without changing prototypes', () => {
		const parsed = JSON.parse('{"__proto__":{"polluted":true},"value":1}') as Record<
			string,
			unknown
		>;
		expect(() => assertPlainJson(parsed)).not.toThrow();
		expect(Object.getPrototypeOf(parsed)).toBe(Object.prototype);
		expect(Object.hasOwn(parsed, '__proto__')).toBe(true);
		expect(({} as Record<string, unknown>)['polluted']).toBeUndefined();
	});

	it('enforces depth and node limits and validates the limits themselves', () => {
		expect(() => assertPlainJson({ a: { b: { c: 1 } } }, { maxDepth: 1, maxNodes: 100 })).toThrow(
			PlainJsonError,
		);
		expect(() => assertPlainJson([1, 2, 3], { maxDepth: 10, maxNodes: 2 })).toThrow(PlainJsonError);
		expect(() => assertPlainJson({ a: 1 }, { maxDepth: 1, maxNodes: 2 })).not.toThrow();
		expect(() => assertPlainJson(1, { maxDepth: 0, maxNodes: 2 })).toThrow(PlainJsonError);
		expect(() => assertPlainJson(1, { maxDepth: 2, maxNodes: 0 })).toThrow(PlainJsonError);
	});
});
