// SPDX-License-Identifier: Apache-2.0
// SPDX-FileCopyrightText: 2026 Rodolfo Carrillo

import { describe, expect, it, vi } from 'vitest';

import { createBuilder, type BuilderSchemaRegistry } from '../src/index.js';

const OBJECT_SCHEMA = {
	$schema: 'http://json-schema.org/draft-07/schema#',
	type: 'object',
	required: ['street'],
	properties: {
		street: { type: 'string', minLength: 2, maxLength: 12 },
		floor: { type: 'integer', minimum: 0, default: 0 },
		kind: { enum: ['home', 'work'] },
		tags: { type: 'array', items: { type: 'string' }, minItems: 1 },
		customData: { type: 'object' },
	},
} as const;

function registry(
	schemas: Readonly<Record<string, unknown>>,
	actions?: readonly string[],
): BuilderSchemaRegistry {
	return {
		get: (action, kind) => schemas[`${action}:${kind}`] ?? schemas[action],
		...(actions === undefined ? {} : { actions: () => actions }),
	};
}

function builderFor(
	schemas: Readonly<Record<string, unknown>>,
	options: Partial<Parameters<typeof createBuilder>[0]> = {},
) {
	return createBuilder({
		version: '2.0.1',
		schemas: registry(schemas),
		messageIds: () => 'id-1',
		...options,
	});
}

describe('builder schema and fields', () => {
	it('describes fields and omits paths', async () => {
		const builder = builderFor({ Example: OBJECT_SCHEMA });
		const fields = await builder.fields('Example', {
			omit: (path) => path[path.length - 1] === 'customData',
		});
		expect(fields.ok).toBe(true);
		if (!fields.ok) return;
		expect(fields.value.kind).toBe('object');
		const names = fields.value.children?.map((field) => field.name);
		expect(names).toEqual(['street', 'floor', 'kind', 'tags']);
		expect(fields.value.children?.[0]).toMatchObject({
			name: 'street',
			required: true,
			kind: 'string',
			minLength: 2,
			maxLength: 12,
		});
	});

	it('resolves local refs and draft-04 exclusive bounds', async () => {
		const builder = builderFor({
			Example: {
				$schema: 'http://json-schema.org/draft-04/schema#',
				type: 'object',
				definitions: { Count: { type: 'integer', minimum: 0, exclusiveMinimum: true } },
				properties: { count: { $ref: '#/definitions/Count' } },
			},
		});
		const fields = await builder.fields('Example');
		expect(fields.ok).toBe(true);
		if (!fields.ok) return;
		expect(fields.value.children?.[0]).toMatchObject({
			kind: 'integer',
			exclusiveMinimum: 0,
		});
	});

	it('reports missing schemas, loader errors and module namespaces', async () => {
		const missing = builderFor({});
		await expect(missing.fields('Missing')).resolves.toMatchObject({
			ok: false,
			error: { code: 'unknown-action' },
		});

		const throwing = createBuilder({
			version: '2.0.1',
			schemas: {
				get: () => {
					throw new Error('registry failed');
				},
			},
		});
		await expect(throwing.fields('Example')).resolves.toMatchObject({
			ok: false,
			error: { code: 'schema-load-failed' },
		});
		await expect(throwing.has('Example')).resolves.toMatchObject({
			ok: false,
			error: { code: 'schema-load-failed' },
		});

		const namespaced = builderFor({ Example: { __esModule: true, default: OBJECT_SCHEMA } });
		await expect(namespaced.fields('Example')).resolves.toMatchObject({
			ok: false,
			error: { code: 'schema-invalid' },
		});
	});

	it('reports throwing field callbacks', async () => {
		const builder = builderFor({ Example: OBJECT_SCHEMA });
		await expect(
			builder.fields('Example', {
				omit: () => {
					throw new Error('omit failed');
				},
			}),
		).resolves.toMatchObject({
			ok: false,
			error: { code: 'schema-invalid' },
		});
	});

	it('returns results for hostile option access', async () => {
		const builder = builderFor({ Example: OBJECT_SCHEMA });
		const hostile = {
			get kind(): never {
				throw new Error('option failed');
			},
		};
		await expect(builder.fields('Example', hostile)).resolves.toMatchObject({
			ok: false,
			error: { code: 'schema-load-failed' },
		});
		await expect(builder.buildPayload('Example', {}, null as never)).resolves.toMatchObject({
			ok: false,
			error: { code: 'schema-load-failed' },
		});
		await expect(
			builder.buildCall(
				'Example',
				{ street: 'Main' },
				{
					get messageId(): never {
						throw new Error('id failed');
					},
				},
			),
		).resolves.toMatchObject({
			ok: false,
			error: { code: 'invalid-message-id', path: [1] },
		});

		const revoked = Proxy.revocable({}, {});
		revoked.revoke();
		await expect(builder.has(revoked.proxy as never)).resolves.toMatchObject({
			ok: false,
			error: { code: 'invalid-action' },
		});
		await expect(builder.fields(revoked.proxy as never)).resolves.toMatchObject({
			ok: false,
			error: { code: 'invalid-action' },
		});
	});

	it('caches loaded schemas per builder instance', async () => {
		const get = vi.fn(() => OBJECT_SCHEMA);
		const builder = createBuilder({
			version: '2.0.1',
			schemas: { get },
		});
		await builder.fields('Example');
		await builder.buildPayload('Example', { street: 'Main' });
		expect(get).toHaveBeenCalledTimes(1);
	});

	it('reports resolve errors and retries failed loads', async () => {
		const unresolved = builderFor({
			Example: { type: 'object', properties: { value: { $ref: '#/definitions/Missing' } } },
		});
		await expect(unresolved.fields('Example')).resolves.toMatchObject({
			ok: false,
			error: { code: 'schema-invalid' },
		});

		let calls = 0;
		const retry = createBuilder({
			version: '2.0.1',
			schemas: {
				get: () => {
					calls += 1;
					if (calls === 1) throw new Error('temporary');
					return OBJECT_SCHEMA;
				},
			},
		});
		await expect(retry.fields('Example')).resolves.toMatchObject({
			ok: false,
			error: { code: 'schema-load-failed' },
		});
		await expect(retry.fields('Example')).resolves.toMatchObject({ ok: true });
		expect(calls).toBe(2);
	});
});

describe('builder payloads', () => {
	it('applies defaults without overwriting present values', async () => {
		const builder = builderFor({ Example: OBJECT_SCHEMA });
		const result = await builder.buildPayload('Example', {
			street: 'Main',
			floor: 0,
		});
		expect(result).toMatchObject({
			ok: true,
			value: { street: 'Main', floor: 0 },
		});
		if (!result.ok) return;
		expect(result.warnings).toEqual([]);

		const noDefaults = await builder.buildPayload(
			'Example',
			{ street: 'Main' },
			{ applyDefaults: false },
		);
		expect(noDefaults).toMatchObject({ ok: true, value: { street: 'Main' } });
	});

	it('rejects missing required values and wrong types', async () => {
		const builder = builderFor({ Example: OBJECT_SCHEMA });
		expect(await builder.buildPayload('Example', {})).toMatchObject({
			ok: false,
			error: { code: 'missing-required', path: ['street'] },
		});
		expect(await builder.buildPayload('Example', { street: 4 })).toMatchObject({
			ok: false,
			error: { code: 'invalid-type', path: ['street'] },
		});
		expect(await builder.buildPayload('Example', { street: 'Main', kind: 'other' })).toMatchObject({
			ok: false,
			error: { code: 'invalid-enum', path: ['kind'] },
		});
	});

	it('checks ranges, Unicode lengths, arrays and unique items', async () => {
		const builder = builderFor({
			Example: {
				type: 'object',
				properties: {
					text: { type: 'string', maxLength: 2 },
					count: { type: 'integer', minimum: 1, maximum: 3 },
					items: { type: 'array', maxItems: 2, uniqueItems: true },
				},
			},
		});
		expect(await builder.buildPayload('Example', { text: '😀😀' })).toMatchObject({ ok: true });
		expect(await builder.buildPayload('Example', { text: '😀😀😀' })).toMatchObject({
			ok: false,
			error: { code: 'too-long' },
		});
		expect(await builder.buildPayload('Example', { count: 4 })).toMatchObject({
			ok: false,
			error: { code: 'out-of-range' },
		});
		expect(await builder.buildPayload('Example', { items: [1, 1] })).toMatchObject({
			ok: false,
			error: { code: 'invalid-payload', path: ['items', 1] },
		});
		const min = builderFor({
			Example: { type: 'object', properties: { text: { type: 'string', minLength: 2 } } },
		});
		expect(await min.buildPayload('Example', { text: 'A' })).toMatchObject({
			ok: false,
			error: { code: 'too-short' },
		});
	});

	it('respects required names that are not in properties', async () => {
		const builder = builderFor({
			Example: { type: 'object', required: ['missing'], properties: {} },
		});
		expect(await builder.buildPayload('Example', {})).toMatchObject({
			ok: false,
			error: { code: 'missing-required', path: ['missing'] },
		});
	});

	it('does not enforce inferred types', async () => {
		const builder = builderFor({
			Example: {
				type: 'object',
				properties: {
					value: { properties: { name: { type: 'string' } } },
				},
			},
		});
		expect(await builder.buildPayload('Example', { value: null })).toMatchObject({ ok: true });
		expect(await builder.buildPayload('Example', { value: 'text' })).toMatchObject({ ok: true });
	});

	it('rejects impossible schemas and non-JSON values', async () => {
		const builder = builderFor({
			Example: { type: 'object', properties: { value: { type: 'array', items: false } } },
		});
		expect(await builder.buildPayload('Example', { value: [1] })).toMatchObject({ ok: false });
		expect(await builder.buildPayload('Example', { value: [] })).toMatchObject({ ok: true });

		const json = await builder.buildPayload('Example', {
			value: [Number.NaN],
		});
		expect(json).toMatchObject({ ok: false, error: { code: 'not-json' } });

		const proto = await builder.buildPayload('Example', {
			value: [],
			__proto__: { polluted: true },
		});
		expect(proto.ok).toBe(false);

		const ownProto = Object.defineProperty({ street: 'Main' }, '__proto__', {
			value: { polluted: true },
			enumerable: true,
			configurable: true,
			writable: true,
		}) as Record<string, unknown>;
		const ownProtoResult = await builder.buildPayload('Example', ownProto);
		expect(ownProtoResult.ok).toBe(true);
		if (ownProtoResult.ok) {
			expect(Object.hasOwn(ownProtoResult.value, '__proto__')).toBe(true);
		}

		const proxy = new Proxy(
			{},
			{
				getPrototypeOf() {
					throw new Error('proxy failed');
				},
			},
		);
		expect(await builder.buildPayload('Example', proxy)).toMatchObject({
			ok: false,
			error: { code: 'not-json' },
		});

		const malformed = builderFor({
			Example: { type: 'object', properties: { value: null as never } },
		});
		expect(await malformed.buildPayload('Example', { value: 1 })).toMatchObject({
			ok: false,
			error: { code: 'schema-invalid', source: 'schema' },
		});

		const arraySchema = builderFor({
			Example: { type: 'object', properties: { value: [] as never } },
		});
		expect(await arraySchema.buildPayload('Example', { value: 1 })).toMatchObject({
			ok: false,
			error: { code: 'schema-invalid', source: 'schema' },
		});
	});

	it('warns about composition but still builds', async () => {
		const builder = builderFor({
			Example: {
				type: 'object',
				properties: { value: { anyOf: [{ type: 'string' }, { type: 'number' }] } },
			},
		});
		const result = await builder.buildPayload('Example', { value: 'x' });
		expect(result).toMatchObject({ ok: true });
		if (!result.ok) return;
		expect(result.warnings[0]).toMatchObject({ code: 'unsupported-keyword' });
	});

	it('creates an empty payload and rejects a non-object root', async () => {
		const builder = builderFor({
			Example: {
				type: 'object',
				required: ['mode'],
				properties: { mode: { enum: ['eco', 'boost'] } },
			},
		});
		expect(await builder.emptyPayload('Example')).toMatchObject({
			ok: true,
			value: { mode: 'eco' },
		});
		const arrayRoot = builderFor({ Example: { type: 'array', items: { type: 'string' } } });
		expect(await arrayRoot.emptyPayload('Example')).toMatchObject({
			ok: false,
			error: { code: 'invalid-payload' },
		});
		const falseRoot = builderFor({ Example: false });
		expect(await falseRoot.emptyPayload('Example')).toMatchObject({
			ok: false,
			error: { code: 'invalid-payload' },
		});
		const scalarRoot = builderFor({ Example: { type: 'string', const: 'x' } });
		expect(await scalarRoot.emptyPayload('Example')).toMatchObject({
			ok: false,
			error: { code: 'invalid-payload' },
		});
	});

	it('enforces payload limits', async () => {
		const builder = builderFor(
			{ Example: { type: 'object' } },
			{ payloadLimits: { maxDepth: 2, maxNodes: 4 } },
		);
		expect(await builder.buildPayload('Example', { a: { b: { c: 1 } } })).toMatchObject({
			ok: false,
			error: { code: 'limit-exceeded' },
		});
	});
});

describe('builder frames', () => {
	it('builds and serializes CALL frames', async () => {
		const builder = builderFor({ Example: OBJECT_SCHEMA });
		const call = await builder.buildCall('Example', { street: 'Main' }, { messageId: 'id-2' });
		expect(call).toMatchObject({
			ok: true,
			value: [2, 'id-2', 'Example', { street: 'Main', floor: 0 }],
		});
		if (!call.ok) return;
		expect(builder.serialize(call.value)).toEqual({
			ok: true,
			value: '[2,"id-2","Example",{"street":"Main","floor":0}]',
			warnings: [],
		});
	});

	it('builds the same frame kinds for OCPP 1.6J', async () => {
		const builder = createBuilder({
			version: '1.6',
			schemas: registry({
				Example: OBJECT_SCHEMA,
				'Example:response': {
					type: 'object',
					required: ['status'],
					properties: { status: { type: 'string' } },
				},
			}),
			messageIds: () => 'id-16',
		});
		const call = await builder.buildCall('Example', { street: 'Main' });
		expect(call).toMatchObject({
			ok: true,
			value: [2, 'id-16', 'Example', { street: 'Main', floor: 0 }],
		});
		expect(await builder.buildResult('Example', { status: 'ok' }, 'id-17')).toMatchObject({
			ok: true,
			value: [3, 'id-17', { status: 'ok' }],
		});
		expect(builder.buildError('id-18', 'FormationViolation', 'bad')).toMatchObject({
			ok: true,
			value: [4, 'id-18', 'FormationViolation', 'bad', {}],
		});
		expect(builder.buildError('id-19', 'FormatViolation', 'bad')).toMatchObject({
			ok: false,
			error: { code: 'invalid-error-code' },
		});
	});

	it('builds CALLRESULT and CALLERROR frames', async () => {
		const builder = createBuilder({
			version: '2.0.1',
			schemas: registry({
				Example: {
					type: 'object',
					required: ['status'],
					properties: { status: { type: 'string' } },
				},
				'Example:response': {
					type: 'object',
					required: ['status'],
					properties: { status: { type: 'string' } },
				},
			}),
		});
		const result = await builder.buildResult('Example', { status: 'Accepted' }, 'id-3');
		expect(result).toMatchObject({ ok: true, value: [3, 'id-3', { status: 'Accepted' }] });
		expect(builder.buildError('id-4', 'FormatViolation', 'bad input')).toMatchObject({
			ok: true,
			value: [4, 'id-4', 'FormatViolation', 'bad input', {}],
		});
		expect(builder.buildError('id-5', 'FormationViolation', 'bad input')).toMatchObject({
			ok: false,
			error: { code: 'invalid-error-code' },
		});
	});

	it('rejects invalid actions, message IDs and frame values', async () => {
		const builder = builderFor({ Example: OBJECT_SCHEMA });
		expect(await builder.buildCall('Bad Action', { street: 'Main' })).toMatchObject({
			ok: false,
			error: { code: 'invalid-action' },
		});
		expect(await builder.buildCall('Example', { street: 'Main' }, { messageId: '' })).toMatchObject(
			{ ok: false, error: { code: 'invalid-message-id' } },
		);
		expect(builder.serialize([2, 'id', 'Example', { at: new Date() }] as never)).toMatchObject({
			ok: false,
			error: { code: 'not-json' },
		});
		expect(
			builder.buildError('id', 'FormatViolation', 'bad', { at: new Date() } as never),
		).toMatchObject({ ok: false, error: { code: 'not-json' } });
	});

	it('validates generated message IDs and generator failures', async () => {
		const throwing = createBuilder({
			version: '2.0.1',
			schemas: registry({ Example: OBJECT_SCHEMA }),
			messageIds: () => {
				throw new Error('no id');
			},
		});
		expect(await throwing.buildCall('Example', { street: 'Main' })).toMatchObject({
			ok: false,
			error: { code: 'invalid-message-id' },
		});
		const long = createBuilder({
			version: '2.0.1',
			schemas: registry({ Example: OBJECT_SCHEMA }),
			messageIds: () => 'x'.repeat(37),
		});
		expect(await long.buildCall('Example', { street: 'Main' })).toMatchObject({
			ok: false,
			error: { code: 'invalid-message-id' },
		});
	});
});

describe('builder registry and examples', () => {
	it('lists actions from options or the registry and reports failures', async () => {
		const fromOptions = builderFor(
			{ Example: OBJECT_SCHEMA },
			{
				actions: ['B', 'A', 'B'],
			},
		);
		expect(await fromOptions.listActions()).toMatchObject({ ok: true, value: ['B', 'A'] });

		const fromRegistry = createBuilder({
			version: '2.0.1',
			schemas: registry({ Example: OBJECT_SCHEMA }, ['Example']),
		});
		expect(await fromRegistry.listActions()).toMatchObject({ ok: true, value: ['Example'] });

		const throwing = createBuilder({
			version: '2.0.1',
			schemas: {
				get: () => OBJECT_SCHEMA,
				actions: () => Promise.reject(new Error('list failed')),
			},
		});
		expect(await throwing.listActions()).toMatchObject({
			ok: false,
			error: { code: 'schema-load-failed' },
		});

		const stringActions = createBuilder({
			version: '2.0.1',
			schemas: registry({ Example: OBJECT_SCHEMA }),
			actions: 'Example' as never,
		});
		expect(await stringActions.listActions()).toMatchObject({
			ok: false,
			error: { code: 'schema-load-failed' },
		});

		const promisedString = createBuilder({
			version: '2.0.1',
			schemas: registry({ Example: OBJECT_SCHEMA }),
			actions: Promise.resolve('Example') as never,
		});
		expect(await promisedString.listActions()).toMatchObject({
			ok: false,
			error: { code: 'schema-load-failed' },
		});
	});

	it('reports has() and returns safe example copies', async () => {
		const builder = builderFor(
			{ Example: OBJECT_SCHEMA },
			{ examples: { Example: { street: 'Main' } } },
		);
		expect(await builder.has('Example')).toMatchObject({ ok: true, value: true });
		expect(await builder.has('Missing')).toMatchObject({ ok: true, value: false });
		expect(await builder.has('Bad Action')).toMatchObject({
			ok: false,
			error: { code: 'invalid-action', source: 'schema' },
		});
		expect(await builder.has('Example', 'nope' as never)).toMatchObject({
			ok: false,
			error: { code: 'invalid-kind' },
		});
		const example = builder.example('Example');
		expect(example).toMatchObject({ ok: true, value: { street: 'Main' } });
		if (!example.ok || example.value === undefined) return;
		example.value['street'] = 'Changed';
		expect(builder.example('Example')).toMatchObject({ ok: true, value: { street: 'Main' } });
		expect(builder.example('Missing')).toMatchObject({ ok: true, value: undefined });
	});

	it('validates construction options', () => {
		expect(() => createBuilder({ version: '2.1.0' as never, schemas: registry({}) })).toThrow(
			'Unsupported OCPP version',
		);
		expect(() => createBuilder({ version: '2.0.1', schemas: {} as never })).toThrow('schemas.get');
		expect(() =>
			createBuilder({
				version: '2.0.1',
				schemas: registry({}),
				payloadLimits: { maxDepth: 0 },
			}),
		).toThrow('payloadLimits.maxDepth');
		expect(() =>
			createBuilder({
				version: '2.0.1',
				schemas: registry({}),
				examples: [] as never,
			}),
		).toThrow('examples');
	});
});
