// SPDX-License-Identifier: Apache-2.0
// SPDX-FileCopyrightText: 2026 Rodolfo Carrillo

import { describe, expect, it } from 'vitest';

import { MAX_FIELD_DEPTH, getFields, type Field } from '../src/fields.js';
import { resolveRefs } from '../src/resolve.js';
import type { ResolvedJsonSchema } from '../src/types.js';

/** Describes a schema that the test writes inline, as a resolved one. */
function fields(schema: unknown, options?: Parameters<typeof getFields>[1]): Field {
	return getFields(schema as ResolvedJsonSchema, options);
}

function child(field: Field, name: string): Field {
	const found = field.children?.find((candidate) => candidate.name === name);
	if (found === undefined) {
		throw new Error(`No field named ${name}`);
	}
	return found;
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

describe('getFields for objects', () => {
	const schema = {
		type: 'object',
		description: 'A charging station.',
		properties: {
			model: { type: 'string', maxLength: 20, description: 'The model.\r\nSecond line.' },
			vendor: { type: 'string', minLength: 1, pattern: '^[A-Z]' },
			serial: { type: 'string' },
		},
		required: ['vendor', 'model'],
		additionalProperties: false,
	};

	it('describes the root', () => {
		expect(fields(schema)).toMatchObject({
			path: [],
			required: false,
			kind: 'object',
			inferred: false,
			nullable: false,
			description: 'A charging station.',
		});
		expect(fields(schema).name).toBeUndefined();
		expect('reason' in fields(schema)).toBe(false);
	});

	it('lists the properties in schema order with their paths and names', () => {
		const root = fields(schema);
		expect(root.children?.map((field) => field.name)).toEqual(['model', 'vendor', 'serial']);
		expect(root.children?.map((field) => field.path)).toEqual([['model'], ['vendor'], ['serial']]);
	});

	it('marks the required properties', () => {
		const root = fields(schema);
		expect(root.children?.map((field) => field.required)).toEqual([true, true, false]);
	});

	it('returns descriptions as written and the constraints that apply', () => {
		const root = fields(schema);
		expect(child(root, 'model')).toMatchObject({
			kind: 'string',
			maxLength: 20,
			description: 'The model.\r\nSecond line.',
		});
		expect(child(root, 'vendor')).toMatchObject({ minLength: 1, pattern: '^[A-Z]' });
		expect('maxLength' in child(root, 'vendor')).toBe(false);
		expect('description' in child(root, 'serial')).toBe(false);
	});

	it('gives an object with no properties an empty list of children', () => {
		expect(fields({ type: 'object' }).children).toEqual([]);
		expect(fields({ type: 'object', properties: {} }).children).toEqual([]);
	});

	it('ignores required names that are not properties, and a required that is not a list', () => {
		const root = fields({
			type: 'object',
			properties: { a: { type: 'string' } },
			required: ['ghost', 5, 'a'],
		});
		expect(root.children?.map((field) => field.required)).toEqual([true]);
		const loose = fields({ type: 'object', properties: { a: {} }, required: 'a' });
		expect(loose.children?.map((field) => field.required)).toEqual([false]);
	});

	it('describes objects nested deeply', () => {
		let nested: unknown = { type: 'string' };
		for (let level = 0; level < 13; level++) {
			nested = { type: 'object', properties: { next: nested }, required: ['next'] };
		}
		let field: Field | undefined = fields(nested);
		const path: string[] = [];
		while (field?.children !== undefined) {
			field = field.children[0];
			path.push('next');
			expect(field?.path).toEqual(path);
		}
		expect(field).toMatchObject({ kind: 'string', required: true });
		expect(path).toHaveLength(13);
	});

	it('keeps property names that are awkward as ordinary names', () => {
		const parsed: unknown = JSON.parse(
			'{"type":"object","properties":{"a.b":{"type":"string"},"__proto__":{"type":"number"},"constructor":{"type":"boolean"},"id":{"type":"string"}}}',
		);
		const root = fields(parsed);
		expect(root.children?.map((field) => field.name)).toEqual([
			'a.b',
			'__proto__',
			'constructor',
			'id',
		]);
		expect(root.children?.map((field) => field.path)).toEqual([
			['a.b'],
			['__proto__'],
			['constructor'],
			['id'],
		]);
		expect(root.children?.[1]?.kind).toBe('number');
	});

	it('lists names that look like indexes first, as JavaScript orders them', () => {
		const root = fields({ type: 'object', properties: { b: {}, '2': {}, a: {}, '1': {} } });
		expect(root.children?.map((field) => field.name)).toEqual(['1', '2', 'b', 'a']);
	});
});

describe('getFields for types', () => {
	it('reads each JSON Schema type', () => {
		for (const type of ['string', 'number', 'integer', 'boolean', 'null', 'array', 'object']) {
			expect(fields({ type })).toMatchObject({ kind: type, inferred: false, nullable: false });
		}
	});

	it('reads a type list with null as nullable', () => {
		expect(fields({ type: ['string', 'null'] })).toMatchObject({ kind: 'string', nullable: true });
		expect(fields({ type: ['null', 'integer'] })).toMatchObject({
			kind: 'integer',
			nullable: true,
		});
		expect(fields({ type: ['string', 'string'] })).toMatchObject({
			kind: 'string',
			nullable: false,
		});
		expect(fields({ type: ['null'] })).toMatchObject({ kind: 'null', nullable: false });
	});

	it('marks several types, and an unknown type, as unsupported', () => {
		expect(fields({ type: ['string', 'number'] })).toMatchObject({
			kind: 'unsupported',
			reason: 'multiple-types',
		});
		expect(fields({ type: 'text' })).toMatchObject({ kind: 'unsupported', reason: 'unknown-type' });
		expect(fields({ type: ['string', 'text'] })).toMatchObject({
			kind: 'unsupported',
			reason: 'unknown-type',
		});
		expect(fields({ type: 5 })).toMatchObject({ kind: 'unsupported', reason: 'unknown-type' });
	});

	it('infers the type of a schema that has none, and says so', () => {
		expect(fields({ properties: { a: {} } })).toMatchObject({ kind: 'object', inferred: true });
		expect(fields({ items: { type: 'string' } })).toMatchObject({ kind: 'array', inferred: true });
		expect(fields({ enum: ['a', 'b'] })).toMatchObject({ kind: 'string', inferred: true });
		expect(fields({ enum: [1, 2, 3] })).toMatchObject({ kind: 'integer', inferred: true });
		expect(fields({ enum: [1, 2.5] })).toMatchObject({ kind: 'number', inferred: true });
		expect(fields({ enum: [1.5, 2.5] })).toMatchObject({ kind: 'number', inferred: true });
		expect(fields({ enum: [true, false] })).toMatchObject({ kind: 'boolean', inferred: true });
		expect(fields({ enum: [null] })).toMatchObject({ kind: 'null', inferred: true });
		expect(fields({ type: [], enum: ['a'] })).toMatchObject({ kind: 'string', inferred: true });
	});

	it('describes a schema that says nothing about the type as any', () => {
		for (const schema of [{}, true, { description: 'free' }, { enum: [] }, { enum: 'x' }]) {
			expect(fields(schema)).toMatchObject({ kind: 'any', inferred: false });
		}
		expect(fields({ enum: ['a', 1] })).toMatchObject({ kind: 'any', inferred: false });
		expect(fields({ enum: [{ a: 1 }, { b: 2 }] })).toMatchObject({ kind: 'any' });
		expect(fields({ enum: [[1], [2]] })).toMatchObject({ kind: 'any' });
	});

	it('prefers the declared type to an inferred one', () => {
		expect(fields({ type: 'string', enum: ['a'] })).toMatchObject({
			kind: 'string',
			inferred: false,
		});
		expect(fields({ type: 'object', items: {} })).toMatchObject({
			kind: 'object',
			inferred: false,
		});
	});

	it('marks false and values that are not schemas as unsupported', () => {
		expect(fields(false)).toMatchObject({ kind: 'unsupported', reason: 'never' });
		for (const value of [5, 'text', null, ['x']]) {
			expect(fields(value)).toMatchObject({ kind: 'unsupported', reason: 'invalid' });
		}
	});

	it('marks composition as unsupported, without guessing, but keeps the metadata', () => {
		const field = fields({
			type: 'object',
			description: 'Either one.',
			properties: { a: { type: 'string' } },
			oneOf: [{ required: ['a'] }, { required: ['b'] }],
		});
		expect(field).toMatchObject({
			kind: 'unsupported',
			reason: 'composition',
			description: 'Either one.',
		});
		expect(field.children).toBeUndefined();
		for (const keyword of ['allOf', 'anyOf', 'oneOf']) {
			expect(fields({ [keyword]: [{ type: 'string' }] })).toMatchObject({ reason: 'composition' });
		}
	});

	it('does not treat a composition keyword that is not a list as composition', () => {
		expect(fields({ type: 'string', allOf: 'x' })).toMatchObject({ kind: 'string' });
	});
});

describe('getFields for values and constraints', () => {
	it('keeps the types of enum values', () => {
		expect(fields({ enum: [1, 'one', true, null, { a: [1] }] }).enum).toEqual([
			1,
			'one',
			true,
			null,
			{ a: [1] },
		]);
		expect(fields({ type: 'integer', enum: [0, 1, 2] }).enum).toEqual([0, 1, 2]);
	});

	it('reads format, default, and every numeric constraint', () => {
		expect(
			fields({
				type: 'number',
				format: 'date-time',
				default: 0,
				minimum: 1,
				maximum: 9,
				exclusiveMinimum: 0,
				exclusiveMaximum: 10,
				multipleOf: 0.5,
				minLength: 2,
				maxLength: 8,
				minItems: 1,
				maxItems: 3,
			}),
		).toMatchObject({
			format: 'date-time',
			default: 0,
			minimum: 1,
			maximum: 9,
			exclusiveMinimum: 0,
			exclusiveMaximum: 10,
			multipleOf: 0.5,
			minLength: 2,
			maxLength: 8,
			minItems: 1,
			maxItems: 3,
		});
	});

	it('keeps a default of false, 0, an empty string, and null', () => {
		for (const value of [false, 0, '', null]) {
			const field = fields({ default: value });
			expect('default' in field).toBe(true);
			expect(field.default).toBe(value);
		}
		expect('default' in fields({})).toBe(false);
	});

	it('ignores constraints and text of the wrong type', () => {
		const field = fields({
			type: 'string',
			minLength: '2',
			maximum: NaN,
			exclusiveMinimum: true,
			description: 5,
			format: ['x'],
			pattern: /x/,
		});
		for (const key of [
			'minLength',
			'maximum',
			'exclusiveMinimum',
			'description',
			'format',
			'pattern',
		]) {
			expect(key in field).toBe(false);
		}
	});

	it('leaves out an enum or a default that is not JSON, and an enum that is not a list', () => {
		const field = fields({ type: 'string', enum: [undefined], default: () => 1 });
		expect('enum' in field).toBe(false);
		expect('default' in field).toBe(false);
		expect('enum' in fields({ type: 'string', enum: 'abc' })).toBe(false);
	});

	it('does not read from the prototype chain', () => {
		const schema = Object.create({ type: 'string', description: 'inherited' }) as object;
		expect(fields(schema)).toMatchObject({ kind: 'any' });
		expect('description' in fields(schema)).toBe(false);
	});

	it('returns copies of enum and default values', () => {
		const schema = { enum: [{ a: 1 }], default: { b: [1] } };
		const field = fields(schema);
		expect(field.enum?.[0]).not.toBe(schema.enum[0]);
		expect(field.default).not.toBe(schema.default);
	});
});

describe('getFields for arrays', () => {
	it('describes the element of an array whose items is one schema', () => {
		const field = fields({
			type: 'array',
			minItems: 1,
			maxItems: 4,
			items: { type: 'object', properties: { id: { type: 'integer' } }, required: ['id'] },
		});
		expect(field).toMatchObject({ kind: 'array', minItems: 1, maxItems: 4 });
		expect(field.item).toMatchObject({ kind: 'object', path: [0], required: false });
		expect(field.item?.children?.[0]).toMatchObject({
			name: 'id',
			path: [0, 'id'],
			required: true,
		});
		expect(field.tuple).toBeUndefined();
	});

	it('uses a number for an index, so it differs from a property called 0', () => {
		const list = fields({ type: 'array', items: { type: 'string' } });
		const object = fields({ type: 'object', properties: { '0': { type: 'string' } } });
		expect(list.item?.path).toEqual([0]);
		expect(object.children?.[0]?.path).toEqual(['0']);
	});

	it('describes the elements of an array whose items is a list', () => {
		const field = fields({ type: 'array', items: [{ type: 'string' }, { type: 'number' }, true] });
		expect(field.tuple?.map((entry) => [entry.path, entry.kind])).toEqual([
			[[0], 'string'],
			[[1], 'number'],
			[[2], 'any'],
		]);
		expect(field.item).toBeUndefined();
	});

	it('describes an array with no items without an element', () => {
		const field = fields({ type: 'array' });
		expect(field).toMatchObject({ kind: 'array' });
		expect(field.item).toBeUndefined();
		expect(field.tuple).toBeUndefined();
	});

	it('describes an array inside an array', () => {
		const field = fields({ type: 'array', items: { type: 'array', items: { type: 'string' } } });
		expect(field.item?.item).toMatchObject({ kind: 'string', path: [0, 0] });
	});

	it('does not give children to a field that is not an object, or elements to one that is not an array', () => {
		expect(fields({ type: 'string', properties: { a: {} }, items: {} }).children).toBeUndefined();
		expect(fields({ type: 'string', items: {} }).item).toBeUndefined();
	});
});

describe('getFields with omit', () => {
	const schema = {
		type: 'object',
		properties: {
			name: { type: 'string' },
			customData: { type: 'object' },
			nested: {
				type: 'object',
				properties: { customData: { type: 'object' }, keep: { type: 'string' } },
			},
		},
	};

	it('leaves out the properties the callback rejects, at any level', () => {
		const root = fields(schema, { omit: (path) => path.at(-1) === 'customData' });
		expect(root.children?.map((field) => field.name)).toEqual(['name', 'nested']);
		expect(child(root, 'nested').children?.map((field) => field.name)).toEqual(['keep']);
	});

	it('gives the callback the path of each property, and never the root', () => {
		const seen: unknown[] = [];
		fields(schema, {
			omit: (path) => {
				seen.push(path);
				return false;
			},
		});
		expect(seen).toEqual([
			['name'],
			['customData'],
			['nested'],
			['nested', 'customData'],
			['nested', 'keep'],
		]);
	});

	it('keeps every property when the callback returns false', () => {
		expect(fields(schema, { omit: () => false }).children).toHaveLength(3);
	});
});

describe('getFields limits and purity', () => {
	it('stops at a depth limit and marks the rest as unsupported', () => {
		let nested: unknown = { type: 'string' };
		for (let level = 0; level < MAX_FIELD_DEPTH + 5; level++) {
			nested = { type: 'object', properties: { next: nested } };
		}
		let field: Field | undefined = fields(nested);
		let depth = 0;
		while (field?.children?.[0] !== undefined) {
			field = field.children[0];
			depth++;
		}
		expect(field).toMatchObject({ kind: 'unsupported', reason: 'too-deep' });
		expect(depth).toBe(MAX_FIELD_DEPTH + 1);
	});

	it('does not loop on a schema that contains itself', () => {
		const schema: Record<string, unknown> = { type: 'object' };
		schema.properties = { self: schema };
		let field: Field | undefined = fields(schema);
		let depth = 0;
		while (field?.children?.[0] !== undefined) {
			field = field.children[0];
			depth++;
		}
		expect(field).toMatchObject({ reason: 'too-deep' });
		expect(depth).toBe(MAX_FIELD_DEPTH + 1);
	});

	it('accepts a frozen schema and leaves it intact', () => {
		const schema = deepFreeze({
			type: 'object',
			properties: { a: { type: 'string', enum: ['x'] } },
			required: ['a'],
		});
		const before = JSON.stringify(schema);
		fields(schema);
		expect(JSON.stringify(schema)).toBe(before);
	});

	it('describes the output of resolveRefs', () => {
		const result = resolveRefs(
			{
				definitions: { Id: { type: 'string', maxLength: 36 } },
				type: 'object',
				properties: { id: { $ref: '#/definitions/Id' } },
				required: ['id'],
			},
			{ dropDefinitions: true },
		);
		if (!result.ok) {
			throw new Error('unreachable');
		}
		expect(getFields(result.value).children).toEqual([
			{
				path: ['id'],
				name: 'id',
				required: true,
				kind: 'string',
				inferred: false,
				nullable: false,
				maxLength: 36,
			},
		]);
	});
});
