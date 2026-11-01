// SPDX-License-Identifier: Apache-2.0
// SPDX-FileCopyrightText: 2026 Rodolfo Carrillo

import { describe, expect, it } from 'vitest';

import { applyDefaults, createEmptyPayload, type EmptyPayloadOptions } from '../src/payload.js';
import { resolveRefs } from '../src/resolve.js';
import type { JsonValue, ResolvedJsonSchema } from '../src/types.js';

function empty(schema: unknown, options?: EmptyPayloadOptions): JsonValue | undefined {
	return createEmptyPayload(schema as ResolvedJsonSchema, options);
}

function withDefaults(schema: unknown, value: unknown): JsonValue {
	const result = applyDefaults(schema as ResolvedJsonSchema, value);
	if (!result.ok) {
		throw new Error(`Expected defaults to apply: ${result.error.message}`);
	}
	return result.value;
}

function deepFreeze<T>(value: T): T {
	if (typeof value === 'object' && value !== null) {
		for (const entry of Object.values(value)) {
			deepFreeze(entry);
		}
		Object.freeze(value);
	}
	return value;
}

describe('createEmptyPayload', () => {
	const schema = {
		type: 'object',
		properties: {
			reason: { type: 'string', enum: ['PowerUp', 'Watchdog'] },
			station: {
				type: 'object',
				properties: {
					model: { type: 'string', maxLength: 20 },
					vendor: { type: 'string', default: 'Acme' },
					serial: { type: 'string', default: 'optional' },
					modem: { type: 'object', properties: { iccid: { type: 'string' } } },
				},
				required: ['model', 'vendor'],
			},
			connectors: { type: 'array', minItems: 1, items: { type: 'object' } },
			note: { type: 'string', default: 'not required' },
		},
		required: ['reason', 'station', 'connectors'],
	};

	it('builds the required skeleton and leaves out what has no value', () => {
		expect(empty(schema)).toEqual({
			reason: 'PowerUp',
			station: { vendor: 'Acme' },
			connectors: [],
		});
	});

	it('does not include optional properties, even with a default', () => {
		const payload = empty(schema) as Record<string, unknown>;
		expect('note' in payload).toBe(false);
		expect('serial' in (payload.station as object)).toBe(false);
		expect('modem' in (payload.station as object)).toBe(false);
	});

	it('fills what has no value with typed zeros on request', () => {
		expect(empty(schema, { fill: 'typed-zero' })).toEqual({
			reason: 'PowerUp',
			station: { model: '', vendor: 'Acme' },
			connectors: [],
		});
		expect(empty(schema, { fill: 'default-or-enum' })).toEqual(empty(schema));
	});

	it('gives each type its zero', () => {
		const payload = empty(
			{
				type: 'object',
				properties: {
					s: { type: 'string' },
					n: { type: 'number' },
					i: { type: 'integer' },
					b: { type: 'boolean' },
					z: { type: 'null' },
					a: {},
					u: { oneOf: [{ type: 'string' }, { type: 'number' }] },
				},
				required: ['s', 'n', 'i', 'b', 'z', 'a', 'u'],
			},
			{ fill: 'typed-zero' },
		);
		expect(payload).toEqual({ s: '', n: 0, i: 0, b: false, z: null });
	});

	it('prefers a default to an enum value, and keeps falsy defaults', () => {
		const payload = empty({
			type: 'object',
			properties: {
				a: { type: 'string', default: 'b', enum: ['a', 'b'] },
				zero: { type: 'integer', default: 0 },
				no: { type: 'boolean', default: false },
				blank: { type: 'string', default: '' },
				first: { type: 'integer', enum: [3, 4] },
				falsy: { type: 'boolean', enum: [false, true] },
			},
			required: ['a', 'zero', 'no', 'blank', 'first', 'falsy'],
		});
		expect(payload).toEqual({ a: 'b', zero: 0, no: false, blank: '', first: 3, falsy: false });
	});

	it('is always null for a null type', () => {
		const payload = empty({
			type: 'object',
			properties: { a: { type: 'null', default: 'x' }, b: { type: 'null' } },
			required: ['a', 'b'],
		});
		expect(payload).toEqual({ a: null, b: null });
	});

	it('expands a required object and ignores its default', () => {
		const payload = empty({
			type: 'object',
			properties: {
				inner: {
					type: 'object',
					default: { other: 1 },
					properties: { x: { type: 'string', default: 'x' } },
					required: ['x'],
				},
			},
			required: ['inner'],
		});
		expect(payload).toEqual({ inner: { x: 'x' } });
	});

	it('does not reach an object that is not required, or what is inside it', () => {
		const payload = empty({
			type: 'object',
			properties: {
				maybe: { type: 'object', properties: { x: { default: 1 } }, required: ['x'] },
			},
		});
		expect(payload).toEqual({});
	});

	it('builds a deeply nested payload', () => {
		let nested: unknown = { type: 'string', default: 'leaf' };
		for (let level = 0; level < 13; level++) {
			nested = { type: 'object', properties: { next: nested }, required: ['next'] };
		}
		let payload = empty(nested) as Record<string, unknown>;
		for (let level = 0; level < 13; level++) {
			payload = payload.next as Record<string, unknown>;
		}
		expect(payload).toBe('leaf');
	});

	it('gives a value for a root that is not an object, or none', () => {
		expect(empty({ type: 'array' })).toEqual([]);
		expect(empty({ type: 'string', enum: ['A'] })).toBe('A');
		expect(empty({ type: 'integer', default: 7 })).toBe(7);
		expect(empty({ type: 'string' })).toBeUndefined();
		expect(empty({ type: 'string' }, { fill: 'typed-zero' })).toBe('');
		expect(empty(true)).toBeUndefined();
		expect(empty(false)).toBeUndefined();
		expect(empty({ oneOf: [{ type: 'string' }] })).toBeUndefined();
		expect(empty(5)).toBeUndefined();
	});

	it('copies a property called __proto__ as data', () => {
		const parsed: unknown = JSON.parse(
			'{"type":"object","properties":{"__proto__":{"type":"string","default":"x"}},"required":["__proto__"]}',
		);
		const payload = empty(parsed) as object;
		expect(Object.getPrototypeOf(payload)).toBe(Object.prototype);
		expect(Object.keys(payload)).toEqual(['__proto__']);
		expect(Object.getOwnPropertyDescriptor(payload, '__proto__')?.value).toBe('x');
	});

	it('returns JSON that shares nothing with the schema', () => {
		const frozen = deepFreeze({
			type: 'object',
			properties: { list: { type: 'array' }, obj: { type: 'object', default: { a: [1] } } },
			required: ['list', 'obj'],
		});
		const before = JSON.stringify(frozen);
		const payload = empty(frozen) as { list: unknown[] };
		payload.list.push(1);
		expect(JSON.stringify(frozen)).toBe(before);
		expect(JSON.parse(JSON.stringify(payload))).toEqual(payload);
		const again = empty(frozen) as { list: unknown[] };
		expect(again.list).toEqual([]);
	});

	it('works on the output of resolveRefs', () => {
		const result = resolveRefs(
			{
				definitions: { Kind: { type: 'string', enum: ['a', 'b'] } },
				type: 'object',
				properties: { kind: { $ref: '#/definitions/Kind' } },
				required: ['kind'],
			},
			{ dropDefinitions: true },
		);
		if (!result.ok) {
			throw new Error('unreachable');
		}
		expect(createEmptyPayload(result.value)).toEqual({ kind: 'a' });
	});
});

describe('applyDefaults', () => {
	const schema = {
		type: 'object',
		properties: {
			name: { type: 'string', default: 'unnamed' },
			count: { type: 'integer', default: 0 },
			on: { type: 'boolean', default: true },
			blank: { type: 'string', default: '' },
			nothing: { default: null },
			free: { type: 'string' },
			nested: {
				type: 'object',
				properties: { level: { type: 'integer', default: 3 }, tag: { type: 'string' } },
			},
		},
	};

	it('fills the properties that are missing', () => {
		expect(withDefaults(schema, {})).toEqual({
			name: 'unnamed',
			count: 0,
			on: true,
			blank: '',
			nothing: null,
		});
	});

	it('never changes a property that is present', () => {
		const value = { name: '', count: 5, on: false, blank: 'x', nothing: 1 };
		expect(withDefaults(schema, value)).toEqual(value);
		expect(withDefaults(schema, { count: 0, on: false, name: '0' })).toMatchObject({
			count: 0,
			on: false,
			name: '0',
		});
	});

	it('keeps a property that is present with the value null', () => {
		expect(withDefaults(schema, { name: null })).toMatchObject({ name: null });
	});

	it('does not create a parent object just to hold a default', () => {
		const result = withDefaults(schema, {}) as Record<string, unknown>;
		expect('nested' in result).toBe(false);
	});

	it('fills a parent that is present', () => {
		expect(withDefaults(schema, { nested: { tag: 't' } })).toMatchObject({
			nested: { tag: 't', level: 3 },
		});
		expect(withDefaults(schema, { nested: {} })).toMatchObject({ nested: { level: 3 } });
	});

	it('fills the properties of a default that is an object', () => {
		const result = withDefaults(
			{
				type: 'object',
				properties: {
					config: {
						type: 'object',
						default: { mode: 'x' },
						properties: { mode: { type: 'string' }, retries: { type: 'integer', default: 2 } },
					},
				},
			},
			{},
		);
		expect(result).toEqual({ config: { mode: 'x', retries: 2 } });
	});

	it('keeps properties the schema does not mention, in order, and adds defaults after them', () => {
		const result = withDefaults(schema, { zeta: 1, name: 'n', alpha: [1, { a: 2 }] });
		expect(Object.keys(result as object)).toEqual([
			'zeta',
			'name',
			'alpha',
			'count',
			'on',
			'blank',
			'nothing',
		]);
		expect((result as { alpha: unknown }).alpha).toEqual([1, { a: 2 }]);
	});

	it('applies defaults to the objects inside an array', () => {
		const list = {
			type: 'object',
			properties: {
				items: {
					type: 'array',
					items: { type: 'object', properties: { qty: { type: 'integer', default: 1 } } },
				},
			},
		};
		expect(withDefaults(list, { items: [{}, { qty: 0 }, { qty: 9 }] })).toEqual({
			items: [{ qty: 1 }, { qty: 0 }, { qty: 9 }],
		});
		expect(withDefaults(list, { items: [] })).toEqual({ items: [] });
	});

	it('applies defaults by position to an array with a list of schemas', () => {
		const tuple = {
			type: 'array',
			items: [
				{ type: 'object', properties: { a: { default: 'a' } } },
				{ type: 'object', properties: { b: { default: 'b' } } },
			],
		};
		expect(withDefaults(tuple, [{}, {}, {}])).toEqual([{ a: 'a' }, { b: 'b' }, {}]);
	});

	it('leaves values of the wrong type, and schemas it cannot read, alone', () => {
		expect(withDefaults(schema, [1, 2])).toEqual([1, 2]);
		expect(withDefaults(schema, 'text')).toBe('text');
		expect(withDefaults(schema, null)).toBeNull();
		expect(withDefaults({ type: 'array' }, { a: 1 })).toEqual({ a: 1 });
		expect(withDefaults({ type: 'array', items: { default: 1 } }, 'x')).toBe('x');
		expect(withDefaults({ type: 'object', properties: { a: { default: 1 } } }, [])).toEqual([]);
		expect(withDefaults({ oneOf: [{ properties: { a: { default: 1 } } }] }, {})).toEqual({});
		expect(withDefaults(true, { a: 1 })).toEqual({ a: 1 });
		expect(
			withDefaults({ properties: { a: { type: 'array', items: { default: 1 } } } }, { a: 5 }),
		).toEqual({
			a: 5,
		});
	});

	it('returns an equal copy when nothing has a default', () => {
		const value = { a: [1, { b: 'c' }], d: null };
		const result = withDefaults({ type: 'object', properties: { a: { type: 'array' } } }, value);
		expect(result).toEqual(value);
		expect(result).not.toBe(value);
	});

	it('does not change the value, which can be frozen, and shares nothing with it', () => {
		const value = deepFreeze({ nested: { tag: 't' }, list: [{ x: 1 }] });
		const before = JSON.stringify(value);
		const result = withDefaults(schema, value) as { nested: object; list: unknown[] };
		expect(JSON.stringify(value)).toBe(before);
		expect(result.nested).not.toBe(value.nested);
		expect(result.list).not.toBe(value.list);
		(result.nested as Record<string, unknown>).tag = 'changed';
		expect(value.nested.tag).toBe('t');
	});

	it('does not share a default between two results', () => {
		const withList = { type: 'object', properties: { tags: { type: 'array', default: ['a'] } } };
		const first = withDefaults(withList, {}) as { tags: string[] };
		first.tags.push('b');
		expect(withDefaults(withList, {})).toEqual({ tags: ['a'] });
		expect(withList.properties.tags.default).toEqual(['a']);
	});

	it('copies __proto__ as an ordinary property', () => {
		const value: unknown = JSON.parse('{"__proto__":{"polluted":true}}');
		const schema: unknown = JSON.parse(
			'{"type":"object","properties":{"a":{"default":1},"__proto__":{"type":"object","default":{"x":1}}}}',
		);
		const result = withDefaults(schema, value) as Record<string, unknown>;
		expect(Object.getPrototypeOf(result)).toBe(Object.prototype);
		expect(Object.keys(result)).toEqual(['__proto__', 'a']);
		expect(result.polluted).toBeUndefined();
	});

	it('rejects a value that is not JSON, with its path', () => {
		for (const [value, path] of [
			[undefined, []],
			[{ a: [1, undefined] }, ['a', 1]],
			[{ n: NaN }, ['n']],
			[{ d: new Date(0) }, ['d']],
		] as const) {
			const result = applyDefaults(schema as ResolvedJsonSchema, value);
			expect(result).toEqual({
				ok: false,
				error: {
					kind: 'invalid-value',
					message: expect.any(String) as string,
					path,
				},
			});
		}
	});

	it('rejects a circular value', () => {
		const value: Record<string, unknown> = {};
		value.self = value;
		expect(applyDefaults(schema as ResolvedJsonSchema, value)).toMatchObject({
			ok: false,
			error: { kind: 'invalid-value', path: ['self'] },
		});
	});

	it('works on the output of resolveRefs', () => {
		const result = resolveRefs(
			{
				definitions: { Mode: { type: 'string', default: 'auto' } },
				type: 'object',
				properties: { mode: { $ref: '#/definitions/Mode' } },
			},
			{ dropDefinitions: true },
		);
		if (!result.ok) {
			throw new Error('unreachable');
		}
		expect(applyDefaults(result.value, {})).toEqual({ ok: true, value: { mode: 'auto' } });
	});
});
