// SPDX-License-Identifier: Apache-2.0
// SPDX-FileCopyrightText: 2026 Rodolfo Carrillo

import { describe, expect, it } from 'vitest';

import { MAX_CLONE_DEPTH, cloneJson } from '../src/clone.js';

function deepFreeze<T>(value: T): T {
	if (typeof value === 'object' && value !== null) {
		for (const child of Object.values(value)) {
			deepFreeze(child);
		}
		Object.freeze(value);
	}
	return value;
}

function nested(depth: number): unknown {
	let value: unknown = 'leaf';
	for (let level = 0; level < depth; level++) {
		value = { next: value };
	}
	return value;
}

describe('cloneJson', () => {
	it('copies primitives', () => {
		for (const value of ['text', '', 0, -0, 1.5, true, false, null]) {
			expect(cloneJson(value)).toEqual({ ok: true, value });
		}
	});

	it('copies nested objects and arrays without sharing them', () => {
		const input = { a: [1, { b: 'c' }], d: { e: null } };
		const result = cloneJson(input);
		expect(result).toEqual({ ok: true, value: input });
		if (!result.ok) {
			throw new Error('unreachable');
		}
		const copy = result.value as typeof input;
		expect(copy).not.toBe(input);
		expect(copy.a).not.toBe(input.a);
		expect(copy.a[1]).not.toBe(input.a[1]);
		expect(copy.d).not.toBe(input.d);
	});

	it('keeps the order of properties', () => {
		const result = cloneJson({ z: 1, a: 2, m: 3 });
		if (!result.ok) {
			throw new Error('unreachable');
		}
		expect(Object.keys(result.value as object)).toEqual(['z', 'a', 'm']);
	});

	it('accepts a frozen input and leaves it intact', () => {
		const input = deepFreeze({ a: [1, 2, { b: true }] });
		expect(cloneJson(input)).toEqual({ ok: true, value: { a: [1, 2, { b: true }] } });
		expect(input).toEqual({ a: [1, 2, { b: true }] });
	});

	it('returns a copy that can be changed', () => {
		const result = cloneJson(deepFreeze({ a: { b: 1 } }));
		if (!result.ok) {
			throw new Error('unreachable');
		}
		const copy = result.value as { a: { b: number } };
		copy.a.b = 2;
		expect(copy.a.b).toBe(2);
	});

	it('accepts an object without a prototype', () => {
		const input = Object.assign(Object.create(null) as object, { a: 1 });
		expect(cloneJson(input)).toEqual({ ok: true, value: { a: 1 } });
	});

	it('copies __proto__ as an ordinary property', () => {
		const input: unknown = JSON.parse('{"__proto__": {"polluted": true}, "a": 1}');
		const result = cloneJson(input);
		if (!result.ok) {
			throw new Error('unreachable');
		}
		const copy = result.value as Record<string, unknown>;
		expect(Object.getPrototypeOf(copy)).toBe(Object.prototype);
		expect(Object.hasOwn(copy, '__proto__')).toBe(true);
		expect(Object.keys(copy)).toEqual(['__proto__', 'a']);
		expect(copy.polluted).toBeUndefined();
		expect(({} as Record<string, unknown>).polluted).toBeUndefined();
	});

	it('ignores symbol keys and properties that are not enumerable', () => {
		const input: Record<string | symbol, unknown> = { visible: 1, [Symbol('hidden')]: 2 };
		Object.defineProperty(input, 'secret', { value: 3, enumerable: false });
		expect(cloneJson(input)).toEqual({ ok: true, value: { visible: 1 } });
	});

	it('rejects values that are not JSON, with their path', () => {
		const cases: [unknown, string][] = [
			[undefined, 'undefined'],
			[() => 1, 'function'],
			[Symbol('s'), 'symbol'],
			[10n, 'bigint'],
		];
		for (const [value, type] of cases) {
			const result = cloneJson({ a: [value] });
			expect(result).toMatchObject({
				ok: false,
				error: { kind: 'not-json', path: ['a', 0] },
			});
			expect(!result.ok && result.error.message).toContain(type);
		}
	});

	it('rejects numbers that JSON cannot represent', () => {
		for (const value of [NaN, Infinity, -Infinity]) {
			expect(cloneJson({ n: value })).toMatchObject({
				ok: false,
				error: { kind: 'not-json', path: ['n'] },
			});
		}
	});

	it('rejects objects that are not plain', () => {
		class Point {
			x = 1;
		}
		for (const value of [new Date(0), new Map(), new Set(), new Point(), /x/]) {
			expect(cloneJson({ v: value })).toMatchObject({
				ok: false,
				error: { kind: 'not-json', path: ['v'] },
			});
		}
	});

	it('rejects accessor properties without calling them', () => {
		let calls = 0;
		const input = {
			get danger() {
				calls++;
				return 1;
			},
		};
		expect(cloneJson(input)).toMatchObject({
			ok: false,
			error: { kind: 'not-json', path: ['danger'] },
		});
		expect(calls).toBe(0);
	});

	it('rejects a sparse array', () => {
		// eslint-disable-next-line no-sparse-arrays
		const input = [1, , 3];
		expect(cloneJson({ list: input })).toMatchObject({
			ok: false,
			error: { kind: 'not-json', path: ['list', 1] },
		});
	});

	it('rejects a circular object and reports where it closes', () => {
		const input: Record<string, unknown> = { a: { b: {} } };
		((input.a as Record<string, unknown>).b as Record<string, unknown>).back = input;
		expect(cloneJson(input)).toMatchObject({
			ok: false,
			error: { kind: 'circular', path: ['a', 'b', 'back'] },
		});
	});

	it('rejects a circular array', () => {
		const input: unknown[] = [];
		input.push(input);
		expect(cloneJson(input)).toMatchObject({ ok: false, error: { kind: 'circular', path: [0] } });
	});

	it('accepts one object that appears twice without a cycle', () => {
		const shared = { x: 1 };
		const result = cloneJson({ a: shared, b: shared });
		expect(result).toEqual({ ok: true, value: { a: { x: 1 }, b: { x: 1 } } });
		if (!result.ok) {
			throw new Error('unreachable');
		}
		const copy = result.value as { a: object; b: object };
		expect(copy.a).not.toBe(copy.b);
	});

	it('accepts nesting up to the limit and rejects deeper values', () => {
		expect(cloneJson(nested(MAX_CLONE_DEPTH)).ok).toBe(true);
		const result = cloneJson(nested(MAX_CLONE_DEPTH + 1));
		expect(result).toMatchObject({ ok: false, error: { kind: 'too-deep' } });
		expect(!result.ok && result.error.path).toHaveLength(MAX_CLONE_DEPTH);
	});

	it('does not share the error path with later calls', () => {
		const first = cloneJson({ a: undefined });
		const second = cloneJson({ b: undefined });
		expect(!first.ok && first.error.path).toEqual(['a']);
		expect(!second.ok && second.error.path).toEqual(['b']);
	});
});
