// SPDX-License-Identifier: Apache-2.0
// SPDX-FileCopyrightText: 2026 Rodolfo Carrillo

import { describe, expect, it, vi } from 'vitest';

import { createSchemaRegistry } from '../src/registry.js';
import type { SchemaRegistry } from '../src/types.js';
import { createValidator } from '../src/validator.js';

function registry(get: SchemaRegistry['get']): SchemaRegistry {
	return { get };
}

describe('createValidator', () => {
	it('keeps the version it was created for', () => {
		const validator = createValidator({
			version: '1.6',
			schemas: registry(() => ({ type: 'object' })),
		});
		expect(validator.version).toBe('1.6');
	});

	it('validates a payload against the request schema', async () => {
		const validator = createValidator({
			version: '2.0.1',
			schemas: registry(() => ({
				type: 'object',
				required: ['id'],
				properties: { id: { type: 'string' } },
			})),
		});

		await expect(validator.validatePayload('Heartbeat', 'request', { id: 'x' })).resolves.toEqual({
			status: 'valid',
			valid: true,
			action: 'Heartbeat',
			issues: [],
			warnings: [],
		});
	});

	it('reports a payload that breaks the schema', async () => {
		const validator = createValidator({
			version: '2.0.1',
			schemas: registry(() => ({
				type: 'object',
				properties: { id: { type: 'string' } },
			})),
		});

		const result = await validator.validatePayload('Heartbeat', 'request', { id: 1 });
		expect(result.status).toBe('invalid-payload');
		expect(result.valid).toBe(false);
		expect(result.action).toBe('Heartbeat');
		expect(result.issues).toHaveLength(1);
		expect(result.issues[0]).toMatchObject({
			code: 'schema-violation',
			keyword: 'type',
			path: ['id'],
			pointer: '/id',
			expected: 'a string',
			received: '1',
		});
		expect(result.issues[0]?.message).toContain('string');
	});

	it('reports an action that the registry does not know', async () => {
		const validator = createValidator({
			version: '1.6',
			schemas: registry(() => undefined),
		});

		await expect(validator.validatePayload('Nope', 'request', {})).resolves.toEqual({
			status: 'unknown-action',
			valid: false,
			action: 'Nope',
			issues: [],
			warnings: [],
		});
	});

	it('reports a schema that could not be loaded', async () => {
		const validator = createValidator({
			version: '1.6',
			schemas: registry(() => Promise.reject(new Error('network down'))),
		});

		const result = await validator.validatePayload('Heartbeat', 'request', {});
		expect(result.status).toBe('schema-missing');
		expect(result.valid).toBe(false);
		expect(result.issues).toHaveLength(1);
		expect(result.issues[0]).toMatchObject({ code: 'schema-load-failed', path: [], pointer: '' });
		expect(result.issues[0]?.message).toContain('network down');
	});

	it('treats a registry that throws as a failed load', async () => {
		const validator = createValidator({
			version: '1.6',
			schemas: registry(() => {
				throw new Error('boom');
			}),
		});

		const result = await validator.validatePayload('Heartbeat', 'request', {});
		expect(result.status).toBe('schema-missing');
		expect(result.issues[0]?.code).toBe('schema-load-failed');
	});

	it('reports a schema that is not a JSON Schema', async () => {
		const validator = createValidator({
			version: '2.0.1',
			schemas: registry(() => null),
		});

		const result = await validator.validatePayload('Heartbeat', 'request', {});
		expect(result.status).toBe('schema-missing');
		expect(result.issues[0]?.code).toBe('schema-invalid');
		expect(result.issues[0]?.message).toContain('object or a boolean');
	});

	it('compiles the strict-mode patterns used by the OCPP schemas', async () => {
		const validator = createValidator({
			version: '2.0.1',
			schemas: registry(() => ({
				type: 'object',
				properties: {
					status: { enum: ['Accepted'], additionalProperties: false },
					values: { type: 'array', items: { type: 'string' }, additionalItems: false },
				},
			})),
		});

		await expect(
			validator.validatePayload('Heartbeat', 'request', {
				status: 'Accepted',
				values: ['one'],
			}),
		).resolves.toMatchObject({ status: 'valid' });
	});

	it('rejects NaN and Infinity as numbers', async () => {
		const validator = createValidator({
			version: '2.0.1',
			schemas: registry(() => ({ type: 'number' })),
		});

		for (const payload of [Number.NaN, Number.POSITIVE_INFINITY, Number.NEGATIVE_INFINITY]) {
			expect((await validator.validatePayload('Heartbeat', 'request', payload)).status).toBe(
				'invalid-payload',
			);
		}
	});

	it('compiles two schemas that share an $id', async () => {
		const validator = createValidator({
			version: '2.0.1',
			schemas: registry(() => ({ $id: 'urn:example:shared', type: 'object' })),
		});

		expect((await validator.validatePayload('Heartbeat', 'request', {})).status).toBe('valid');
		expect((await validator.validatePayload('Heartbeat', 'response', {})).status).toBe('valid');
	});

	it('reports a schema that Ajv cannot compile', async () => {
		const validator = createValidator({
			version: '2.0.1',
			schemas: registry(() => ({ type: 'not-a-json-schema-type' })),
		});

		const result = await validator.validatePayload('Heartbeat', 'request', {});
		expect(result.status).toBe('schema-missing');
		expect(result.issues[0]?.code).toBe('schema-invalid');
		expect(result.issues[0]?.message).toContain('could not be compiled');
	});

	it('reports a payload that makes Ajv throw as a schema problem', async () => {
		const validator = createValidator({
			version: '2.0.1',
			schemas: registry(() => ({
				type: 'object',
				properties: { id: { type: 'string' } },
			})),
		});
		const payload = Object.defineProperty({}, 'id', {
			enumerable: true,
			get: () => {
				throw new Error('boom');
			},
		});

		const result = await validator.validatePayload('Heartbeat', 'request', payload);
		expect(result.status).toBe('schema-missing');
		expect(result.issues[0]?.code).toBe('schema-invalid');
		expect(result.issues[0]?.message).toContain('could not validate the payload');
	});

	it('loads and compiles a schema once for concurrent calls', async () => {
		const get = vi.fn<SchemaRegistry['get']>(() => ({ type: 'object' }));
		const validator = createValidator({ version: '2.0.1', schemas: registry(get) });

		const [first, second] = await Promise.all([
			validator.validatePayload('Heartbeat', 'request', {}),
			validator.validatePayload('Heartbeat', 'request', {}),
		]);
		expect(first.status).toBe('valid');
		expect(second.status).toBe('valid');
		expect(get).toHaveBeenCalledTimes(1);
	});

	it('uses a different cache entry for each kind', async () => {
		const get = vi.fn<SchemaRegistry['get']>(() => ({ type: 'object' }));
		const validator = createValidator({ version: '2.0.1', schemas: registry(get) });

		await validator.validatePayload('Heartbeat', 'request', {});
		await validator.validatePayload('Heartbeat', 'response', {});
		expect(get.mock.calls).toEqual([
			['Heartbeat', 'request'],
			['Heartbeat', 'response'],
		]);
	});

	it('tries to load a schema again after a failed load', async () => {
		const get = vi
			.fn<SchemaRegistry['get']>()
			.mockRejectedValueOnce(new Error('first'))
			.mockResolvedValueOnce({ type: 'object' });
		const validator = createValidator({ version: '2.0.1', schemas: registry(get) });

		expect((await validator.validatePayload('Heartbeat', 'request', {})).status).toBe(
			'schema-missing',
		);
		expect((await validator.validatePayload('Heartbeat', 'request', {})).status).toBe('valid');
		expect(get).toHaveBeenCalledTimes(2);
	});

	it('asks for an action again after an unknown action', async () => {
		const get = vi
			.fn<SchemaRegistry['get']>()
			.mockReturnValueOnce(undefined)
			.mockReturnValueOnce({ type: 'object' });
		const validator = createValidator({ version: '2.0.1', schemas: registry(get) });

		expect((await validator.validatePayload('Heartbeat', 'request', {})).status).toBe(
			'unknown-action',
		);
		expect((await validator.validatePayload('Heartbeat', 'request', {})).status).toBe('valid');
		expect(get).toHaveBeenCalledTimes(2);
	});

	it('tries to compile a schema again after a compilation failure', async () => {
		const get = vi
			.fn<SchemaRegistry['get']>()
			.mockReturnValueOnce({ type: 'not-a-json-schema-type' })
			.mockReturnValueOnce({ type: 'object' });
		const validator = createValidator({ version: '2.0.1', schemas: registry(get) });

		expect((await validator.validatePayload('Heartbeat', 'request', {})).status).toBe(
			'schema-missing',
		);
		expect((await validator.validatePayload('Heartbeat', 'request', {})).status).toBe('valid');
	});

	it('accepts decimal multipleOf values without floating point errors', async () => {
		const validator = createValidator({
			version: '1.6',
			schemas: registry(() => ({
				type: 'object',
				required: ['limit'],
				properties: { limit: { type: 'number', multipleOf: 0.1 } },
			})),
		});

		expect(
			(await validator.validatePayload('SetChargingProfile', 'request', { limit: 0.3 })).status,
		).toBe('valid');
		expect(
			(await validator.validatePayload('SetChargingProfile', 'request', { limit: 0.35 })).status,
		).toBe('invalid-payload');
	});

	it('applies the formats of ajv-formats', async () => {
		const validator = createValidator({
			version: '2.0.1',
			schemas: registry(() => ({
				type: 'object',
				required: ['when', 'url'],
				properties: {
					when: { type: 'string', format: 'date-time' },
					url: { type: 'string', format: 'uri' },
				},
			})),
		});

		expect(
			(
				await validator.validatePayload('Heartbeat', 'request', {
					when: '2026-01-01T00:00:00Z',
					url: 'https://example.com',
				})
			).status,
		).toBe('valid');
		const badDate = await validator.validatePayload('Heartbeat', 'request', {
			when: 'not a date',
			url: 'https://example.com',
		});
		expect(badDate.status).toBe('invalid-payload');
		expect(badDate.issues[0]).toMatchObject({
			keyword: 'format',
			expected: 'a valid date-time',
		});

		const badUrl = await validator.validatePayload('Heartbeat', 'request', {
			when: '2026-01-01T00:00:00Z',
			url: 'not a uri',
		});
		expect(badUrl.status).toBe('invalid-payload');
		expect(badUrl.issues[0]).toMatchObject({ keyword: 'format', expected: 'a valid uri' });
	});

	it('maps the parameter names of every keyword', async () => {
		const cases: [string, unknown, unknown, string, string][] = [
			['enum', { type: 'string', enum: ['a', 'b'] }, 'c', 'one of the allowed values', '"c"'],
			['const', { const: 'a' }, 'b', 'the allowed value', '"b"'],
			['minLength', { type: 'string', minLength: 3 }, 'ab', 'at least 3 characters', '"ab"'],
			['maxLength', { type: 'string', maxLength: 2 }, 'abc', 'at most 2 characters', '"abc"'],
			['minimum', { type: 'number', minimum: 1 }, 0, 'at least 1', '0'],
			['maximum', { type: 'number', maximum: 1 }, 2, 'at most 1', '2'],
			['exclusiveMinimum', { type: 'number', exclusiveMinimum: 1 }, 1, 'greater than 1', '1'],
			['exclusiveMaximum', { type: 'number', exclusiveMaximum: 1 }, 1, 'less than 1', '1'],
			['pattern', { type: 'string', pattern: '^a$' }, 'b', 'a string matching ^a$', '"b"'],
			['minItems', { type: 'array', minItems: 1 }, [], 'at least 1 item', 'array'],
			['maxItems', { type: 'array', maxItems: 1 }, [1, 2], 'at most 1 item', 'array'],
			[
				'additionalItems',
				{ type: 'array', items: [{ type: 'string' }], additionalItems: false },
				['a', 'b'],
				'no additional items',
				'array',
			],
			[
				'uniqueItems',
				{ type: 'array', uniqueItems: true },
				[1, 1],
				'a list of unique items',
				'array',
			],
			['type', { type: ['string', 'null'] }, 1, 'a string or null', '1'],
		];

		for (const [keyword, schema, payload, expected, received] of cases) {
			const validator = createValidator({
				version: '2.0.1',
				schemas: registry(() => schema),
			});
			const result = await validator.validatePayload('Heartbeat', 'request', payload);
			expect(result.status).toBe('invalid-payload');
			expect(result.issues[0]).toMatchObject({ keyword, expected, received });
		}
	});

	it('uses payload paths and RFC 6901 pointers', async () => {
		const validator = createValidator({
			version: '2.0.1',
			schemas: registry(() => ({
				type: 'object',
				required: ['a/b', 'a~b'],
				properties: {
					'a/b': { type: 'string' },
					'a~b': { type: 'string' },
				},
			})),
		});

		const result = await validator.validatePayload('Heartbeat', 'request', {
			'a/b': 1,
			'a~b': 2,
		});
		expect(result.status).toBe('invalid-payload');
		expect(result.issues.map((issue) => issue.path)).toEqual([['a/b'], ['a~b']]);
		expect(result.issues.map((issue) => issue.pointer)).toEqual(['/a~1b', '/a~0b']);
	});

	it('uses numbers for array indexes', async () => {
		const validator = createValidator({
			version: '2.0.1',
			schemas: registry(() => ({
				type: 'object',
				properties: { tags: { type: 'array', items: { type: 'string' } } },
			})),
		});

		const result = await validator.validatePayload('Heartbeat', 'request', { tags: ['ok', 1] });
		expect(result.status).toBe('invalid-payload');
		expect(result.issues[0]).toMatchObject({
			path: ['tags', 1],
			pointer: '/tags/1',
			received: '1',
		});
	});

	it('adds the missing property to a required error', async () => {
		const validator = createValidator({
			version: '2.0.1',
			schemas: registry(() => ({
				type: 'object',
				required: ['id'],
				properties: { id: { type: 'string' } },
			})),
		});

		const result = await validator.validatePayload('Heartbeat', 'request', {});
		expect(result.status).toBe('invalid-payload');
		expect(result.issues[0]).toMatchObject({
			keyword: 'required',
			path: ['id'],
			pointer: '/id',
			expected: 'required',
			received: 'missing',
		});
		expect(result.issues[0]?.message).toContain('required');
	});

	it('does not treat inherited properties as present', async () => {
		const validator = createValidator({
			version: '2.0.1',
			schemas: registry(() => ({
				type: 'object',
				required: ['toString'],
				properties: { toString: { type: 'string' } },
			})),
		});

		const result = await validator.validatePayload('Heartbeat', 'request', {});
		expect(result.status).toBe('invalid-payload');
		expect(result.issues[0]).toMatchObject({
			keyword: 'required',
			path: ['toString'],
			received: 'missing',
		});
	});

	it('does not read accessors when describing an issue', async () => {
		const validator = createValidator({
			version: '2.0.1',
			schemas: registry(() => ({
				type: 'object',
				properties: {},
				additionalProperties: false,
			})),
		});
		const payload = Object.defineProperty({}, 'extra', {
			enumerable: true,
			get: () => {
				throw new Error('do not read');
			},
		});

		const result = await validator.validatePayload('Heartbeat', 'request', payload);
		expect(result.status).toBe('invalid-payload');
		expect(result.issues[0]).toMatchObject({
			keyword: 'additionalProperties',
			path: ['extra'],
			received: 'missing',
		});
	});

	it('adds the extra property to an additionalProperties error', async () => {
		const validator = createValidator({
			version: '2.0.1',
			schemas: registry(() => ({
				type: 'object',
				properties: {},
				additionalProperties: false,
			})),
		});

		const result = await validator.validatePayload('Heartbeat', 'request', { extra: 1 });
		expect(result.status).toBe('invalid-payload');
		expect(result.issues[0]).toMatchObject({
			keyword: 'additionalProperties',
			path: ['extra'],
			pointer: '/extra',
			expected: 'no additional properties',
			received: '1',
		});
	});

	it('does not insert defaults', async () => {
		const validator = createValidator({
			version: '2.0.1',
			schemas: registry(() => ({
				type: 'object',
				properties: { id: { type: 'string', default: 'generated' } },
			})),
		});
		const payload = {};

		const result = await validator.validatePayload('Heartbeat', 'request', payload);
		expect(result.status).toBe('valid');
		expect(payload).toEqual({});
		expect(Object.hasOwn(payload, 'id')).toBe(false);
	});

	it('does not mutate a frozen payload', async () => {
		const validator = createValidator({
			version: '2.0.1',
			schemas: registry(() => ({
				type: 'object',
				required: ['id'],
				properties: { id: { type: 'string' } },
			})),
		});
		const payload = Object.freeze({});

		const result = await validator.validatePayload('Heartbeat', 'request', payload);
		expect(result.status).toBe('invalid-payload');
		expect(payload).toEqual({});
	});

	it('reports every error in a stable order', async () => {
		const validator = createValidator({
			version: '2.0.1',
			schemas: registry(() => ({
				type: 'object',
				required: ['b', 'a'],
				properties: { a: { type: 'string' }, b: { type: 'string' } },
			})),
		});

		const result = await validator.validatePayload('Heartbeat', 'request', {});
		expect(result.status).toBe('invalid-payload');
		expect(result.issues.map((issue) => issue.pointer)).toEqual(['/a', '/b']);
	});

	it('truncates a long received value', async () => {
		const validator = createValidator({
			version: '2.0.1',
			schemas: registry(() => ({
				type: 'object',
				properties: { id: { type: 'number' } },
			})),
		});

		const result = await validator.validatePayload('Heartbeat', 'request', { id: 'x'.repeat(50) });
		expect(result.status).toBe('invalid-payload');
		expect(result.issues[0]?.received).toHaveLength(40);
		expect(result.issues[0]?.received?.endsWith('…')).toBe(true);
	});

	it('reports a false schema as an invalid payload', async () => {
		const validator = createValidator({
			version: '2.0.1',
			schemas: registry(() => false),
		});

		const result = await validator.validatePayload('Heartbeat', 'request', {});
		expect(result.status).toBe('invalid-payload');
		expect(result.issues[0]).toMatchObject({ code: 'schema-violation', path: [], pointer: '' });
	});

	it('works with the registry built by createSchemaRegistry', async () => {
		const schemas = createSchemaRegistry({
			version: '2.0.1',
			files: ['2.0.1/HeartbeatRequest.json'],
			load: (fileName) =>
				fileName === 'HeartbeatRequest.json'
					? {
							type: 'object',
							required: ['currentTime'],
							properties: { currentTime: { type: 'string', format: 'date-time' } },
						}
					: undefined,
		});
		const validator = createValidator({ version: '2.0.1', schemas });

		await expect(
			validator.validatePayload('Heartbeat', 'request', { currentTime: '2026-01-01T00:00:00Z' }),
		).resolves.toMatchObject({ status: 'valid', valid: true });
	});

	it('reports the file name when the registry could not load it', async () => {
		const schemas = createSchemaRegistry({
			version: '2.0.1',
			load: () => {
				throw new Error('boom');
			},
		});
		const validator = createValidator({ version: '2.0.1', schemas });

		const result = await validator.validatePayload('Heartbeat', 'request', {});
		expect(result.status).toBe('schema-missing');
		expect(result.issues[0]?.message).toContain('HeartbeatRequest.json');
	});
});
