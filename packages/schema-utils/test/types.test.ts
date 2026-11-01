// SPDX-License-Identifier: Apache-2.0
// SPDX-FileCopyrightText: 2026 Rodolfo Carrillo

import { describe, expect, it } from 'vitest';

import type { JsonSchema, JsonValue, Path, Result } from '../src/index.js';

describe('types', () => {
	it('accepts a draft-04 style schema', () => {
		const schema: JsonSchema = {
			id: 'urn:example:schema-utils:legacy',
			$schema: 'http://json-schema.org/draft-04/schema#',
			type: 'object',
			properties: {
				id: { type: 'string', maxLength: 20 },
				type: { type: 'string', enum: ['A', 'B'] },
				level: { type: 'number', minimum: 0, exclusiveMinimum: true },
			},
			required: ['id'],
			additionalProperties: false,
		};
		expect(schema).toBeTypeOf('object');
	});

	it('accepts a draft-06 style schema with references and unknown keywords', () => {
		const schema: JsonSchema = {
			$id: 'urn:example:schema-utils:modern',
			definitions: { Name: { type: 'string', javaType: 'Name' } },
			properties: { name: { $ref: '#/definitions/Name' }, always: true, never: false },
			exclusiveMinimum: 1,
			vendorKeyword: { anything: [1, 2, 3] },
		};
		expect(schema).toBeTypeOf('object');
	});

	it('accepts boolean schemas', () => {
		const schemas: JsonSchema[] = [true, false];
		expect(schemas).toHaveLength(2);
	});

	it('lets a JSON value be used as a default and as an enum member', () => {
		const value: JsonValue = { a: [1, 'two', null, { b: false }] };
		const schema: JsonSchema = { default: value, enum: [value, 1, 'x'] };
		expect(schema).toBeTypeOf('object');
	});

	it('describes locations as segments and outcomes as results', () => {
		const path: Path = ['properties', 'list', 0];
		const outcome: Result<Path, { message: string }> = { ok: true, value: path };
		expect(outcome.ok).toBe(true);
	});
});
