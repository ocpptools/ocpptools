// SPDX-License-Identifier: Apache-2.0
// SPDX-FileCopyrightText: 2026 Rodolfo Carrillo

import { Ajv } from 'ajv';
import addFormatsModule from 'ajv-formats';
import { normalizeSchema } from '@ocpptools/schema-utils';
import { describe, expect, it } from 'vitest';

import type { SchemaRegistry } from '../src/types.js';
import { createValidator } from '../src/validator.js';

const DRAFT_06 = 'http://json-schema.org/draft-06/schema#';
const addFormats = addFormatsModule as unknown as (ajv: Ajv) => Ajv;

function registry(schema: unknown): SchemaRegistry {
	return { get: () => schema };
}

function validatorFor(schema: Record<string, unknown>) {
	return createValidator({
		version: '2.0.1',
		schemas: registry({ $schema: DRAFT_06, ...schema }),
	});
}

/**
 * The hard-coded expectations in `cases` are the primary oracle. This second
 * check compiles the raw schema with a fresh Ajv, without the package
 * normalization, so a normalization bug cannot hide behind the same code path.
 * `$schema` is dropped because Ajv 8 does not register the draft-06
 * meta-schema by default; the keywords used here are compatible with its
 * draft-07 engine.
 */
function ajvAccepts(schema: Record<string, unknown>, payload: unknown): boolean {
	const ajv = new Ajv({
		addUsedSchema: false,
		allErrors: true,
		logger: false,
		multipleOfPrecision: 6,
		ownProperties: true,
		strictSchema: false,
	});
	addFormats(ajv);
	const body = { ...schema };
	delete body['$schema'];
	const validate = ajv.compile(body);
	return validate(payload);
}

interface Case {
	readonly name: string;
	readonly schema: Record<string, unknown>;
	readonly valid: readonly unknown[];
	readonly invalid: readonly unknown[];
}

const cases: readonly Case[] = [
	{
		name: 'resolves local $ref against definitions',
		schema: {
			type: 'object',
			required: ['item'],
			properties: { item: { $ref: '#/definitions/item' } },
			definitions: { item: { type: 'string', const: 'fixed' } },
		},
		valid: [{ item: 'fixed' }],
		invalid: [{ item: 'other' }, {}],
	},
	{
		name: 'compares const by value for objects and arrays',
		schema: {
			type: 'object',
			properties: {
				object: { const: { a: 1, b: [2] } },
				array: { const: [1, { a: true }] },
				order: { const: { b: 2, a: 1 } },
			},
		},
		valid: [{ object: { a: 1, b: [2] }, array: [1, { a: true }], order: { a: 1, b: 2 } }],
		invalid: [{ object: { a: 1, b: [3] } }, { array: [1, { a: false }] }],
	},
	{
		name: 'requires at least one item to match contains',
		schema: { type: 'array', contains: { type: 'integer', minimum: 2 } },
		valid: [[1, 2, 3], [2]],
		invalid: [[], [1], [0, 1]],
	},
	{
		name: 'ignores contains when the instance is not an array',
		schema: { type: 'string', contains: { type: 'integer' } },
		valid: ['text'],
		invalid: [1],
	},
	{
		name: 'restricts property names with propertyNames',
		schema: { type: 'object', propertyNames: { pattern: '^[a-z]+$' } },
		valid: [{ alpha: 1, beta: 2 }],
		invalid: [{ Alpha: 1 }, { 'a-b': 1 }],
	},
	{
		name: 'ignores propertyNames when the instance is not an object',
		schema: { type: 'array', propertyNames: { pattern: '^a' } },
		valid: [[1, 2]],
		invalid: ['text'],
	},
	{
		name: 'uses numeric exclusiveMinimum and exclusiveMaximum',
		schema: { type: 'number', exclusiveMinimum: 0, exclusiveMaximum: 10 },
		valid: [0.5, 5, 9.99],
		invalid: [0, 10, -1, 11],
	},
	{
		name: 'enforces property dependencies',
		schema: {
			type: 'object',
			dependencies: { creditCard: ['billingAddress'] },
		},
		valid: [{ creditCard: 'x', billingAddress: 'y' }, { name: 'x' }],
		invalid: [{ creditCard: 'x' }],
	},
	{
		name: 'enforces schema dependencies',
		schema: {
			type: 'object',
			dependencies: { creditCard: { required: ['billingAddress'] } },
		},
		valid: [{ creditCard: 'x', billingAddress: 'y' }, { name: 'x' }],
		invalid: [{ creditCard: 'x' }],
	},
	{
		name: 'accepts an integral number for integer',
		// `1.0` cannot be told apart from `1` in JavaScript, so this checks the
		// numeric rule only, not the draft-04 lexical difference.
		schema: { type: 'integer' },
		valid: [1, -3],
		invalid: [1.5, '1'],
	},
	{
		name: 'treats examples as an annotation',
		schema: { type: 'string', examples: ['shown-in-docs'] },
		valid: ['anything', 'shown-in-docs'],
		invalid: [1],
	},
	{
		name: 'validates date-time with the formats plugin',
		schema: { type: 'string', format: 'date-time' },
		valid: ['2026-01-10T12:00:00Z'],
		invalid: ['2026-01-10', 'not-a-date'],
	},
	{
		name: 'supports false schemas in properties',
		schema: { type: 'object', properties: { forbidden: false } },
		valid: [{}],
		invalid: [{ forbidden: 1 }],
	},
	{
		name: 'applies additionalItems with tuple items',
		schema: {
			type: 'array',
			items: [{ type: 'string' }],
			additionalItems: false,
		},
		valid: [['a']],
		invalid: [['a', 'b']],
	},
	{
		name: 'ignores additionalItems when items is a single schema',
		schema: {
			type: 'array',
			items: { type: 'string' },
			additionalItems: false,
		},
		valid: [['a', 'b']],
		invalid: [['a', 1]],
	},
	{
		name: 'uses the draft-06 $id keyword',
		schema: {
			$id: 'urn:example:root',
			type: 'object',
			required: ['value'],
			properties: {
				value: { $ref: '#/definitions/value' },
			},
			definitions: { value: { const: 1 } },
		},
		valid: [{ value: 1 }],
		invalid: [{ value: 2 }],
	},
];

describe('JSON Schema draft-06 conformance', () => {
	for (const testCase of cases) {
		it(`${testCase.name}: matches Ajv`, async () => {
			const validator = validatorFor(testCase.schema);
			for (const payload of testCase.valid) {
				const result = await validator.validatePayload('Example', 'request', payload);
				expect(result.valid, `expected valid: ${JSON.stringify(payload)}`).toBe(true);
				expect(ajvAccepts(testCase.schema, payload)).toBe(true);
			}
			for (const payload of testCase.invalid) {
				const result = await validator.validatePayload('Example', 'request', payload);
				expect(result.status).toBe('invalid-payload');
				expect(result.valid, `expected invalid: ${JSON.stringify(payload)}`).toBe(false);
				expect(ajvAccepts(testCase.schema, payload)).toBe(false);
			}
		});
	}

	it('ignores if/then/else in a draft-06 schema', async () => {
		// These keywords are draft-07. Draft-06 must ignore them, not enforce
		// them, so the payload is valid even when the branch would fail.
		const validator = validatorFor({
			type: 'object',
			if: { required: ['a'] },
			then: { required: ['b'] },
			properties: { a: { type: 'number' } },
		});
		const result = await validator.validatePayload('Example', 'request', { a: 1 });
		expect(result).toMatchObject({ status: 'valid', valid: true });
	});

	it('supports boolean root schemas', async () => {
		const always = createValidator({ version: '2.0.1', schemas: registry(true) });
		expect(await always.validatePayload('Example', 'request', { a: 1 })).toMatchObject({
			valid: true,
		});

		const never = createValidator({ version: '2.0.1', schemas: registry(false) });
		const result = await never.validatePayload('Example', 'request', {});
		expect(result).toMatchObject({ status: 'invalid-payload', valid: false });
	});

	it('rejects the draft-04 boolean exclusiveMinimum in a draft-06 schema', async () => {
		const validator = validatorFor({
			type: 'number',
			minimum: 0,
			exclusiveMinimum: true,
		});
		const result = await validator.validatePayload('Example', 'request', 1);
		expect(result.status).toBe('schema-missing');
		expect(result.issues[0]?.code).toBe('schema-invalid');
		expect(result.issues[0]?.message).toContain('exclusiveMinimum');

		const numeric = validatorFor({ type: 'number', exclusiveMinimum: 0.5 });
		expect(await numeric.validatePayload('Example', 'request', 1)).toMatchObject({
			valid: true,
		});
	});

	it('reports the draft it detected through normalizeSchema', () => {
		const normalized = normalizeSchema({
			$schema: DRAFT_06,
			type: 'object',
			properties: { value: { const: 1 } },
		});
		expect(normalized.ok).toBe(true);
		if (!normalized.ok) return;
		expect(normalized.value.draft).toBe('draft-06');
		expect(normalized.value.schema).toMatchObject({
			$schema: 'http://json-schema.org/draft-07/schema#',
		});
	});
});
