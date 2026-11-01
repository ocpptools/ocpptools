// SPDX-License-Identifier: Apache-2.0
// SPDX-FileCopyrightText: 2026 Rodolfo Carrillo

import { describe, expect, it } from 'vitest';

import { normalizeSchema, type NormalizeOptions, type NormalizedSchema } from '../src/normalize.js';

const DRAFT_04 = 'http://json-schema.org/draft-04/schema#';
const DRAFT_06 = 'http://json-schema.org/draft-06/schema#';
const DRAFT_07 = 'http://json-schema.org/draft-07/schema#';

function normalized(schema: unknown, options?: NormalizeOptions): NormalizedSchema {
	const result = normalizeSchema(schema, options);
	if (!result.ok) {
		throw new Error(`Expected a normalized schema: ${result.error.message}`);
	}
	return result.value;
}

function deepFreeze<T>(value: T): T {
	if (typeof value === 'object' && value !== null) {
		for (const child of Object.values(value)) {
			deepFreeze(child);
		}
		Object.freeze(value);
	}
	return value;
}

describe('normalizeSchema from draft-04', () => {
	it('renames id to $id and updates $schema, keeping the key order', () => {
		const result = normalized({
			$schema: DRAFT_04,
			id: 'urn:example:legacy',
			type: 'object',
			additionalProperties: false,
		});
		expect(result.draft).toBe('draft-04');
		expect(result.warnings).toEqual([]);
		expect(result.schema).toEqual({
			$schema: DRAFT_07,
			$id: 'urn:example:legacy',
			type: 'object',
			additionalProperties: false,
		});
		expect(Object.keys(result.schema as object)).toEqual([
			'$schema',
			'$id',
			'type',
			'additionalProperties',
		]);
	});

	it('renames id in nested schemas', () => {
		const result = normalized({
			$schema: DRAFT_04,
			definitions: { Part: { id: '#part', type: 'string' } },
			properties: { item: { id: 'item', type: 'object' } },
		});
		expect(result.schema).toEqual({
			$schema: DRAFT_07,
			definitions: { Part: { $id: '#part', type: 'string' } },
			properties: { item: { $id: 'item', type: 'object' } },
		});
	});

	it('does not touch properties that are called id or type', () => {
		const schema = {
			$schema: DRAFT_04,
			type: 'object',
			properties: {
				id: { type: 'string', maxLength: 20 },
				type: { type: 'string', enum: ['A', 'B'] },
				minimum: { type: 'number' },
				exclusiveMinimum: { type: 'boolean' },
			},
			required: ['id', 'type'],
		};
		expect(normalized(schema).schema).toEqual({ ...schema, $schema: DRAFT_07 });
	});

	it('does not rename an id that is not a string', () => {
		const result = normalized({ $schema: DRAFT_04, properties: { a: { id: 5 } } });
		expect(result.schema).toEqual({ $schema: DRAFT_07, properties: { a: { id: 5 } } });
	});

	it('keeps $id and drops id when both are present, with a warning', () => {
		const result = normalized({ $schema: DRAFT_04, definitions: { A: { id: 'old', $id: 'new' } } });
		expect(result.schema).toEqual({ $schema: DRAFT_07, definitions: { A: { $id: 'new' } } });
		expect(result.warnings).toEqual([
			{
				code: 'id-conflict',
				message: expect.stringContaining('"$id" is kept') as string,
				path: ['definitions', 'A'],
			},
		]);
	});

	it('turns exclusive bounds into numeric ones', () => {
		const result = normalized({
			$schema: DRAFT_04,
			properties: {
				low: { type: 'number', minimum: 5, exclusiveMinimum: true },
				high: { type: 'number', exclusiveMaximum: true, maximum: 9.5 },
				both: { minimum: 0, maximum: 1, exclusiveMinimum: true, exclusiveMaximum: true },
			},
		});
		expect(result.warnings).toEqual([]);
		expect(result.schema).toEqual({
			$schema: DRAFT_07,
			properties: {
				low: { type: 'number', exclusiveMinimum: 5 },
				high: { type: 'number', exclusiveMaximum: 9.5 },
				both: { exclusiveMinimum: 0, exclusiveMaximum: 1 },
			},
		});
	});

	it('keeps an inclusive bound when the exclusive flag is false', () => {
		const result = normalized({
			$schema: DRAFT_04,
			minimum: 1,
			exclusiveMinimum: false,
			maximum: 2,
			exclusiveMaximum: false,
		});
		expect(result.schema).toEqual({ $schema: DRAFT_07, minimum: 1, maximum: 2 });
	});

	it('drops an exclusive flag of true that has no numeric bound, with a warning', () => {
		const result = normalized({
			$schema: DRAFT_04,
			properties: {
				none: { exclusiveMinimum: true },
				text: { minimum: '5', exclusiveMaximum: true },
			},
		});
		expect(result.schema).toEqual({
			$schema: DRAFT_07,
			properties: { none: {}, text: { minimum: '5' } },
		});
		expect(result.warnings.map((warning) => [warning.code, warning.path])).toEqual([
			['ignored-exclusive-bound', ['properties', 'none']],
			['ignored-exclusive-bound', ['properties', 'text']],
		]);
	});

	it('leaves a numeric exclusive bound alone', () => {
		const result = normalized({ $schema: DRAFT_04, minimum: 1, exclusiveMinimum: 3 });
		expect(result.schema).toEqual({ $schema: DRAFT_07, minimum: 1, exclusiveMinimum: 3 });
	});
});

describe('normalizeSchema at every schema position', () => {
	const input = {
		$schema: DRAFT_04,
		id: 'urn:example:positions',
		properties: { a: { id: 'a' } },
		patternProperties: { '^x': { id: 'x' } },
		definitions: { D: { id: 'd' } },
		dependencies: { a: { id: 'dep' }, b: ['a'] },
		additionalProperties: { id: 'ap' },
		additionalItems: { id: 'ai' },
		items: [{ id: 'i0' }, true, { id: 'i2' }],
		allOf: [{ id: 'all' }, true],
		anyOf: [{ id: 'any' }],
		oneOf: [{ id: 'one' }],
		not: { id: 'not' },
		contains: { id: 'contains' },
		propertyNames: { id: 'names' },
		if: { id: 'if' },
		then: { id: 'then' },
		else: { id: 'else' },
	};

	it('converts every nested schema', () => {
		expect(normalized(input).schema).toEqual({
			$schema: DRAFT_07,
			$id: 'urn:example:positions',
			properties: { a: { $id: 'a' } },
			patternProperties: { '^x': { $id: 'x' } },
			definitions: { D: { $id: 'd' } },
			dependencies: { a: { $id: 'dep' }, b: ['a'] },
			additionalProperties: { $id: 'ap' },
			additionalItems: { $id: 'ai' },
			items: [{ $id: 'i0' }, true, { $id: 'i2' }],
			allOf: [{ $id: 'all' }, true],
			anyOf: [{ $id: 'any' }],
			oneOf: [{ $id: 'one' }],
			not: { $id: 'not' },
			contains: { $id: 'contains' },
			propertyNames: { $id: 'names' },
			if: { $id: 'if' },
			then: { $id: 'then' },
			else: { $id: 'else' },
		});
	});

	it('converts a single items schema', () => {
		const result = normalized({
			$schema: DRAFT_04,
			items: { id: 'one', minimum: 1, exclusiveMinimum: true },
		});
		expect(result.schema).toEqual({
			$schema: DRAFT_07,
			items: { $id: 'one', exclusiveMinimum: 1 },
		});
	});

	it('leaves keywords that hold the wrong kind of value as they are', () => {
		const schema = {
			$schema: DRAFT_04,
			allOf: 'x',
			properties: [1],
			items: 4,
			not: 'y',
			definitions: null,
		};
		expect(normalized(schema).schema).toEqual({ ...schema, $schema: DRAFT_07 });
	});

	it('does not walk into data', () => {
		const data = { id: 'keep', minimum: 1, exclusiveMinimum: true, nested: [{ id: 'keep' }] };
		const result = normalized({
			$schema: DRAFT_04,
			default: data,
			enum: [data, 1],
			examples: [data],
			const: data,
			vendorKeyword: data,
		});
		expect(result.schema).toEqual({
			$schema: DRAFT_07,
			default: data,
			enum: [data, 1],
			examples: [data],
			const: data,
			vendorKeyword: data,
		});
	});

	it('copies __proto__ as a property name', () => {
		const result = normalized(
			JSON.parse(`{"$schema":"${DRAFT_04}","properties":{"__proto__":{"id":"p","type":"string"}}}`),
		);
		const properties = (result.schema as { properties: object }).properties;
		expect(Object.getPrototypeOf(properties)).toBe(Object.prototype);
		expect(Object.keys(properties)).toEqual(['__proto__']);
		expect(Object.getOwnPropertyDescriptor(properties, '__proto__')?.value).toEqual({
			$id: 'p',
			type: 'string',
		});
	});
});

describe('normalizeSchema from draft-06 and draft-07', () => {
	it('only updates $schema in a draft-06 schema', () => {
		const schema = {
			$schema: DRAFT_06,
			$id: 'urn:example:modern',
			definitions: { Name: { type: 'string', id: 'not-renamed' } },
			properties: { n: { $ref: '#/definitions/Name' }, level: { exclusiveMinimum: 3, minimum: 1 } },
			exclusiveMaximum: 10,
		};
		const result = normalized(schema);
		expect(result.draft).toBe('draft-06');
		expect(result.warnings).toEqual([]);
		expect(result.schema).toEqual({ ...schema, $schema: DRAFT_07 });
	});

	it('returns a draft-07 schema unchanged', () => {
		const schema = {
			$schema: 'https://json-schema.org/draft-07/schema',
			$id: 'urn:example:current',
			if: { required: ['a'] },
			then: { properties: { b: { const: 1 } } },
			id: 'stays',
		};
		const result = normalized(schema);
		expect(result.draft).toBe('draft-07');
		expect(result.schema).toEqual(schema);
	});

	it('does not add $schema to a draft-07 schema that has none', () => {
		expect(normalized({ type: 'object' }).schema).toEqual({ type: 'object' });
	});
});

describe('normalizeSchema without $schema', () => {
	it('reads it as draft-07 by default', () => {
		const schema = { id: 'stays', minimum: 1, exclusiveMinimum: true };
		const result = normalized(schema);
		expect(result.draft).toBe('draft-07');
		expect(result.schema).toEqual(schema);
	});

	it('converts it when told the default draft, and adds $schema first', () => {
		const result = normalized(
			{ id: 'urn:example:assumed', type: 'object' },
			{ defaultDraft: 'draft-04' },
		);
		expect(result.draft).toBe('draft-04');
		expect(result.schema).toEqual({
			$schema: DRAFT_07,
			$id: 'urn:example:assumed',
			type: 'object',
		});
		expect(Object.keys(result.schema as object)[0]).toBe('$schema');
	});

	it('adds $schema when the assumed draft is draft-06', () => {
		const result = normalized({ type: 'object' }, { defaultDraft: 'draft-06' });
		expect(result.schema).toEqual({ $schema: DRAFT_07, type: 'object' });
	});

	it('prefers $schema over the default draft', () => {
		const result = normalized({ $schema: DRAFT_07, id: 'stays' }, { defaultDraft: 'draft-04' });
		expect(result.draft).toBe('draft-07');
		expect(result.schema).toEqual({ $schema: DRAFT_07, id: 'stays' });
	});
});

describe('normalizeSchema with a boolean schema', () => {
	it('returns it as it is', () => {
		expect(normalized(true)).toEqual({ schema: true, draft: 'draft-07', warnings: [] });
		expect(normalized(false, { defaultDraft: 'draft-04' })).toEqual({
			schema: false,
			draft: 'draft-04',
			warnings: [],
		});
	});

	it('keeps boolean subschemas', () => {
		const schema = { $schema: DRAFT_04, additionalProperties: false, properties: { a: true } };
		expect(normalized(schema).schema).toEqual({ ...schema, $schema: DRAFT_07 });
	});
});

describe('normalizeSchema with an unsupported draft', () => {
	it('returns the schema unchanged and warns', () => {
		const schema = {
			$schema: 'https://json-schema.org/draft/2020-12/schema',
			id: 'stays',
			javaType: 'stays',
			minimum: 1,
			exclusiveMinimum: true,
		};
		const result = normalized(schema, { stripUnknownKeywords: true });
		expect(result.draft).toBe('unknown');
		expect(result.schema).toEqual(schema);
		expect(result.warnings).toEqual([
			{
				code: 'unknown-draft',
				message: expect.stringContaining('2020-12') as string,
				path: [],
			},
		]);
	});

	it('warns for a $schema that is not a string', () => {
		const result = normalized({ $schema: 7 });
		expect(result.draft).toBe('unknown');
		expect(result.schema).toEqual({ $schema: 7 });
		expect(result.warnings).toHaveLength(1);
	});
});

describe('normalizeSchema with stripUnknownKeywords', () => {
	const input = {
		$schema: DRAFT_06,
		$id: 'urn:example:strip',
		type: 'object',
		comment: 'free text',
		javaType: 'Example',
		definitions: { Part: { type: 'string', javaType: 'Part', description: 'kept' } },
		properties: {
			javaType: { type: 'string', default: 'kept' },
			list: { type: 'array', items: { type: 'object', javaType: 'Item' }, minItems: 1 },
		},
		default: { javaType: 'data', comment: 'data' },
	};

	it('keeps unknown keywords by default', () => {
		expect(normalized(input).schema).toEqual({ ...input, $schema: DRAFT_07 });
	});

	it('removes them from schemas but not from property names or data', () => {
		const result = normalized(input, { stripUnknownKeywords: true });
		expect(result.warnings).toEqual([]);
		expect(result.schema).toEqual({
			$schema: DRAFT_07,
			$id: 'urn:example:strip',
			type: 'object',
			definitions: { Part: { type: 'string', description: 'kept' } },
			properties: {
				javaType: { type: 'string', default: 'kept' },
				list: { type: 'array', items: { type: 'object' }, minItems: 1 },
			},
			default: { javaType: 'data', comment: 'data' },
		});
	});

	it('keeps the draft-07 keywords it knows', () => {
		const schema = {
			$comment: 'c',
			title: 't',
			readOnly: true,
			writeOnly: false,
			pattern: '^a',
			uniqueItems: true,
			maxProperties: 2,
			minProperties: 1,
			contentMediaType: 'text/plain',
			contentEncoding: 'base64',
			multipleOf: 2,
			format: 'date-time',
			const: 1,
			examples: [1],
			required: ['a'],
		};
		expect(normalized(schema, { stripUnknownKeywords: true }).schema).toEqual(schema);
	});

	it('drops a draft-04 id that could not be renamed', () => {
		const result = normalized(
			{ $schema: DRAFT_04, id: 5, type: 'object' },
			{ stripUnknownKeywords: true },
		);
		expect(result.schema).toEqual({ $schema: DRAFT_07, type: 'object' });
	});
});

describe('normalizeSchema keeps the input and the output apart', () => {
	it('accepts a frozen input and leaves it intact', () => {
		const input = deepFreeze({
			$schema: DRAFT_04,
			id: 'urn:example:frozen',
			properties: { a: { minimum: 1, exclusiveMinimum: true, enum: [1, 2] } },
		});
		const before = JSON.stringify(input);
		const result = normalized(input, { stripUnknownKeywords: true });
		expect(JSON.stringify(input)).toBe(before);
		expect(result.schema).toEqual({
			$schema: DRAFT_07,
			$id: 'urn:example:frozen',
			properties: { a: { exclusiveMinimum: 1, enum: [1, 2] } },
		});
	});

	it('returns a value that shares nothing with the input', () => {
		const input = { $schema: DRAFT_07, enum: [{ a: 1 }], default: { b: [1] } };
		const result = normalized(input).schema as typeof input;
		expect(result).not.toBe(input);
		expect(result.enum[0]).not.toBe(input.enum[0]);
		expect(result.default.b).not.toBe(input.default.b);
	});

	it('gives the same result when it is run twice', () => {
		const schemas: unknown[] = [
			{
				$schema: DRAFT_04,
				id: 'urn:example:twice',
				properties: { a: { minimum: 1, exclusiveMinimum: true }, id: { type: 'string' } },
			},
			{ $schema: DRAFT_06, $id: 'urn:example:twice', exclusiveMinimum: 1 },
			{ $schema: DRAFT_07, type: 'object' },
			{ type: 'object', id: 'x' },
			true,
		];
		for (const schema of schemas) {
			const once = normalized(schema, { defaultDraft: 'draft-04' });
			expect(normalized(once.schema)).toEqual({ ...once, draft: 'draft-07', warnings: [] });
		}
	});
});

describe('normalizeSchema with input that is not a schema', () => {
	it('rejects values that are not objects or booleans', () => {
		for (const value of [null, 0, 'text', [], [{}]]) {
			expect(normalizeSchema(value)).toEqual({
				ok: false,
				error: {
					kind: 'invalid-schema',
					message: expect.stringContaining('object or a boolean') as string,
					path: [],
				},
			});
		}
	});

	it('rejects values that are not JSON, with their path', () => {
		const cases: [unknown, unknown[]][] = [
			[undefined, []],
			[() => 1, []],
			[{ properties: { a: { default: undefined } } }, ['properties', 'a', 'default']],
			[{ minimum: NaN }, ['minimum']],
			[{ default: new Date(0) }, ['default']],
		];
		for (const [value, path] of cases) {
			expect(normalizeSchema(value)).toMatchObject({
				ok: false,
				error: { kind: 'invalid-schema', path },
			});
		}
	});

	it('rejects a circular schema', () => {
		const schema: Record<string, unknown> = { type: 'object' };
		schema.properties = { self: schema };
		expect(normalizeSchema(schema)).toMatchObject({
			ok: false,
			error: { kind: 'invalid-schema', path: ['properties', 'self'] },
		});
	});
});
