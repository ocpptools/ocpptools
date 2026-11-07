// SPDX-License-Identifier: Apache-2.0
// SPDX-FileCopyrightText: 2026 Rodolfo Carrillo

import { describe, expect, it } from 'vitest';

import { minimalPayload } from './helpers/minimal-payload.js';

describe('minimalPayload', () => {
	it('builds a required object without optional properties', () => {
		const schema = {
			type: 'object',
			required: ['name', 'count'],
			properties: {
				name: { type: 'string', minLength: 3 },
				count: { type: 'integer', minimum: 1 },
				optional: { type: 'string' },
			},
			additionalProperties: false,
		};

		expect(minimalPayload(schema)).toEqual({ name: 'xxx', count: 1 });
	});

	it('builds arrays with the minimum number of items', () => {
		const schema = {
			type: 'array',
			minItems: 2,
			items: { type: 'string', format: 'uri' },
		};

		expect(minimalPayload(schema)).toEqual(['https://example.com', 'https://example.com']);
	});

	it('uses the first enum value, const, and default', () => {
		expect(minimalPayload({ enum: [3, 4] })).toBe(3);
		expect(minimalPayload({ const: { a: 1 } })).toEqual({ a: 1 });
		expect(minimalPayload({ default: { b: 2 } })).toEqual({ b: 2 });
	});

	it('clones enum and default values instead of returning schema references', () => {
		const schema = { enum: [{ a: 1 }] };
		const payload = minimalPayload(schema);
		expect(payload).toEqual({ a: 1 });
		if (typeof payload === 'object' && payload !== null) {
			(payload as { a: number }).a = 2;
		}
		expect(schema.enum[0]).toEqual({ a: 1 });
	});

	it('respects string lengths and formats', () => {
		expect(minimalPayload({ type: 'string', minLength: 3, maxLength: 5 })).toBe('xxx');
		expect(minimalPayload({ type: 'string', format: 'date-time' })).toBe('2026-01-01T00:00:00Z');
		expect(minimalPayload({ type: 'string', format: 'uri' })).toBe('https://example.com');
	});

	it('respects numeric bounds and multipleOf', () => {
		expect(minimalPayload({ type: 'number', minimum: 0.1, multipleOf: 0.1 })).toBe(0.1);
		expect(minimalPayload({ type: 'integer', minimum: 2, maximum: 10, multipleOf: 2 })).toBe(2);
		expect(minimalPayload({ type: 'number', exclusiveMinimum: 0, maximum: 10 })).toBe(5);
		expect(minimalPayload({ type: 'number', maximum: 0 })).toBe(0);
		expect(
			minimalPayload({
				type: 'number',
				exclusiveMinimum: 0.05,
				maximum: 0.15,
				multipleOf: 0.1,
			}),
		).toBe(0.1);
		expect(minimalPayload({ type: 'integer', exclusiveMinimum: 0.1, maximum: 1.5 })).toBe(1);
		expect(minimalPayload({ type: 'integer', maximum: -0.25 })).toBe(-1);
		expect(minimalPayload({ type: 'object', required: [] })).toEqual({});
	});

	it('builds booleans, nulls, and true schemas', () => {
		expect(minimalPayload({ type: 'boolean' })).toBe(false);
		expect(minimalPayload({ type: 'null' })).toBeNull();
		expect(minimalPayload({ type: ['string', 'null'] })).toBe('');
		expect(minimalPayload({ type: 'array', minItems: 2 })).toEqual([{}, {}]);
		expect(minimalPayload({ type: 'object' })).toEqual({});
		expect(minimalPayload(true)).toEqual({});
	});

	it('resolves local references and normalizes draft-04 bounds', () => {
		const draft04 = {
			$schema: 'http://json-schema.org/draft-04/schema#',
			type: 'number',
			minimum: 0,
			exclusiveMinimum: true,
			multipleOf: 0.5,
		};
		expect(minimalPayload(draft04)).toBe(0.5);
		expect(
			minimalPayload({
				definitions: { Name: { type: 'string', minLength: 2 } },
				$ref: '#/definitions/Name',
			}),
		).toBe('xx');
	});

	it('does not mutate the schema', () => {
		const schema = {
			type: 'object',
			required: ['id'],
			properties: { id: { type: 'string', minLength: 2 } },
		};
		const before = JSON.stringify(schema);
		const payload = minimalPayload(schema);
		expect(payload).toEqual({ id: 'xx' });
		expect(JSON.stringify(schema)).toBe(before);
	});

	it('fails loudly for unsupported constructs', () => {
		expect(() => minimalPayload({ type: 'string', pattern: '^a$' })).toThrow('Patterns');
		expect(() => minimalPayload({ type: 'string', format: 'email' })).toThrow('format');
		expect(() => minimalPayload({ oneOf: [{ type: 'string' }] })).toThrow('Composition');
		expect(() => minimalPayload({ allOf: [{ type: 'string' }] })).toThrow('Composition');
		expect(() => minimalPayload({ $ref: 'other.json#/definitions/X' })).toThrow();
		expect(() => minimalPayload({ type: 'array', items: [{ type: 'string' }] })).toThrow('Tuple');
		expect(() => minimalPayload(false)).toThrow('false schema');
		expect(() => minimalPayload({ type: 'string', minLength: 4, maxLength: 2 })).toThrow(
			'maxLength',
		);
		expect(() => minimalPayload({ type: 'number', minimum: 2, maximum: 1 })).toThrow(
			'numeric bounds',
		);
		expect(() => minimalPayload({ type: 'string', format: 'date-time', maxLength: 5 })).toThrow(
			'length constraints',
		);
		expect(() => minimalPayload({ type: 'object', minProperties: 1 })).toThrow('does not validate');
		expect(() =>
			minimalPayload({ type: 'array', minItems: 2, uniqueItems: true, items: { const: 1 } }),
		).toThrow('does not validate');
	});
});
