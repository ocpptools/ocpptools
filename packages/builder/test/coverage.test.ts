// SPDX-License-Identifier: Apache-2.0
// SPDX-FileCopyrightText: 2026 Rodolfo Carrillo

import { describe, expect, it } from 'vitest';

import { createBuilder } from '../src/index.js';
import { describeValue, messageOf } from '../src/errors.js';
import { cloneJson } from '../src/json.js';

function builderFor(
	schema: unknown,
	options: Record<string, unknown> = {},
	response: unknown = schema,
) {
	return createBuilder({
		version: '2.0.1',
		schemas: { get: (_action: string, kind: string) => (kind === 'response' ? response : schema) },
		messageIds: () => 'id-1',
		...options,
	} as never);
}

const OBJECT = { type: 'object', properties: { value: { type: 'string' } } };

describe('builder coverage: helpers', () => {
	it('describes hostile and primitive values', () => {
		expect(messageOf(new Error('boom'))).toBe('boom');
		expect(messageOf({})).toBe('unknown error');
		const hostile = new Proxy(new Error('x'), {
			get(target, property, receiver) {
				if (property === 'message') throw new Error('hostile');
				return Reflect.get(target, property, receiver) as unknown;
			},
		});
		expect(messageOf(hostile, 'fallback')).toBe('fallback');
		expect(describeValue(null)).toBe('null');
		expect(describeValue([])).toBe('array');
		expect(describeValue('x'.repeat(50))).toContain('…');
		expect(describeValue({})).toBe('object');
		expect(describeValue(() => undefined)).toBe('function');
		const revoked = Proxy.revocable([], {});
		revoked.revoke();
		expect(describeValue(revoked.proxy)).toBe('unreadable value');
	});

	it('clones valid plain JSON and rejects invalid values', () => {
		expect(cloneJson({ value: [1, true, null] }, { maxDepth: 10, maxNodes: 10 })).toEqual({
			ok: true,
			value: { value: [1, true, null] },
		});
		expect(cloneJson(Number.NaN, { maxDepth: 10, maxNodes: 10 })).toMatchObject({
			ok: false,
			error: { code: 'not-json' },
		});
		expect(cloneJson(new Date(), { maxDepth: 10, maxNodes: 10 })).toMatchObject({
			ok: false,
			error: { code: 'not-json' },
		});
		const sparse = new Array(1);
		expect(cloneJson(sparse, { maxDepth: 10, maxNodes: 10 })).toMatchObject({
			ok: false,
			error: { code: 'not-json' },
		});
		const cycle: Record<string, unknown> = {};
		cycle['self'] = cycle;
		expect(cloneJson(cycle, { maxDepth: 10, maxNodes: 10 })).toMatchObject({
			ok: false,
			error: { code: 'not-json' },
		});
		const symbol = { value: 1 } as Record<string | symbol, unknown>;
		symbol[Symbol('x')] = 2;
		expect(cloneJson(symbol, { maxDepth: 10, maxNodes: 10 })).toMatchObject({
			ok: false,
			error: { code: 'not-json' },
		});
		let invoked = false;
		const accessor = {};
		Object.defineProperty(accessor, 'value', {
			enumerable: true,
			get() {
				invoked = true;
				return 1;
			},
		});
		expect(cloneJson(accessor, { maxDepth: 10, maxNodes: 10 })).toMatchObject({
			ok: false,
			error: { code: 'not-json' },
		});
		expect(invoked).toBe(false);
		expect(cloneJson({ a: { b: 1 } }, { maxDepth: 1, maxNodes: 10 })).toMatchObject({
			ok: false,
			error: { code: 'limit-exceeded' },
		});
		expect(cloneJson([1, 2, 3], { maxDepth: 10, maxNodes: 2 })).toMatchObject({
			ok: false,
			error: { code: 'limit-exceeded' },
		});
	});
});

describe('builder coverage: payloads', () => {
	it('handles empty payload roots and fills', async () => {
		const booleanTrue = builderFor(true);
		expect(await booleanTrue.emptyPayload('Example')).toMatchObject({ ok: true, value: {} });

		const booleanFalse = builderFor(false);
		expect(await booleanFalse.emptyPayload('Example')).toMatchObject({
			ok: false,
			error: { code: 'invalid-payload' },
		});

		const scalar = builderFor({ type: 'string', const: 'x' });
		expect(await scalar.emptyPayload('Example')).toMatchObject({
			ok: false,
			error: { code: 'invalid-payload' },
		});

		const typed = builderFor({
			type: 'object',
			required: ['count', 'enabled', 'text'],
			properties: {
				count: { type: 'integer' },
				enabled: { type: 'boolean' },
				text: { type: 'string' },
			},
		});
		expect(await typed.emptyPayload('Example', { fill: 'typed-zero' })).toMatchObject({
			ok: true,
			value: { count: 0, enabled: false, text: '' },
		});
	});

	it('checks object/array constraints and schemas', async () => {
		const builder = builderFor({
			type: 'object',
			minProperties: 1,
			properties: {
				list: {
					type: 'array',
					minItems: 1,
					maxItems: 2,
					items: [{ type: 'string' }],
					additionalItems: false,
				},
				number: { type: 'number', multipleOf: 0.5, exclusiveMinimum: 0, exclusiveMaximum: 2 },
				value: { const: 'fixed' },
				union: { type: ['string', 'null'] },
			},
		});
		expect(await builder.buildPayload('Example', {})).toMatchObject({
			ok: false,
			error: { code: 'out-of-range' },
		});
		expect(
			await builder.buildPayload('Example', {
				list: ['a'],
				number: 0.5,
				value: 'fixed',
				union: null,
			}),
		).toMatchObject({ ok: true });
		expect(await builder.buildPayload('Example', { list: [] })).toMatchObject({
			ok: false,
			error: { code: 'out-of-range' },
		});
		expect(await builder.buildPayload('Example', { list: ['a', 'b', 'c'] })).toMatchObject({
			ok: false,
			error: { code: 'out-of-range' },
		});
		expect(await builder.buildPayload('Example', { list: ['a'], number: 0.3 })).toMatchObject({
			ok: false,
			error: { code: 'out-of-range' },
		});
		expect(await builder.buildPayload('Example', { list: ['a'], number: 2 })).toMatchObject({
			ok: false,
			error: { code: 'out-of-range' },
		});
		expect(await builder.buildPayload('Example', { list: ['a'], value: 'other' })).toMatchObject({
			ok: false,
			error: { code: 'invalid-enum' },
		});
		expect(await builder.buildPayload('Example', { list: ['a'], union: 1 })).toMatchObject({
			ok: false,
			error: { code: 'invalid-type' },
		});
		expect(await builder.buildPayload('Example', { list: ['a'], extra: 1 })).toMatchObject({
			ok: true,
		});

		const maxProperties = builderFor({
			type: 'object',
			maxProperties: 1,
			properties: { a: {}, b: {} },
		});
		expect(await maxProperties.buildPayload('Example', { a: 1, b: 2 })).toMatchObject({
			ok: false,
			error: { code: 'out-of-range' },
		});
	});

	it('checks additionalItems without maxItems and numeric bounds', async () => {
		const tuple = builderFor({
			type: 'object',
			properties: {
				items: {
					type: 'array',
					items: [{ type: 'string' }],
					additionalItems: false,
				},
			},
		});
		expect(await tuple.buildPayload('Example', { items: ['a', 1] })).toMatchObject({
			ok: false,
			error: { code: 'invalid-payload' },
		});

		const bounds = builderFor({
			type: 'object',
			properties: { value: { type: 'number', minimum: 1, maximum: 3 } },
		});
		expect(await bounds.buildPayload('Example', { value: 0 })).toMatchObject({
			ok: false,
			error: { code: 'out-of-range' },
		});
		expect(await bounds.buildPayload('Example', { value: 4 })).toMatchObject({
			ok: false,
			error: { code: 'out-of-range' },
		});
	});

	it('handles tuple and additionalItems with a schema', async () => {
		const builder = builderFor({
			type: 'object',
			properties: {
				items: {
					type: 'array',
					items: [{ type: 'string' }],
					additionalItems: { type: 'number' },
				},
			},
		});
		expect(await builder.buildPayload('Example', { items: ['a', 1] })).toMatchObject({ ok: true });
		expect(await builder.buildPayload('Example', { items: ['a', 'b'] })).toMatchObject({
			ok: false,
			error: { code: 'invalid-type' },
		});
		const noItems = builderFor({ type: 'object', properties: { items: { type: 'array' } } });
		expect(await noItems.buildPayload('Example', { items: [1, 'a'] })).toMatchObject({ ok: true });
	});

	it('rejects non-object roots and malformed defaults', async () => {
		const builder = builderFor(OBJECT);
		expect(await builder.buildPayload('Example', [])).toMatchObject({
			ok: false,
			error: { code: 'invalid-payload' },
		});
		const hostile = {
			get applyDefaults(): never {
				throw new Error('option');
			},
		};
		expect(await builder.buildPayload('Example', { value: 'x' }, hostile)).toMatchObject({
			ok: false,
			error: { code: 'invalid-payload' },
		});
		const fillHostile = {
			get fill(): never {
				throw new Error('fill');
			},
		};
		const empty = builderFor({ type: 'object', properties: {} });
		expect(await empty.emptyPayload('Example', fillHostile)).toMatchObject({
			ok: false,
			error: { code: 'invalid-payload' },
		});
	});

	it('validates kind options and index examples', async () => {
		const builder = builderFor(OBJECT);
		expect(await builder.fields('Example', { kind: 'bad' as never })).toMatchObject({
			ok: false,
			error: { code: 'invalid-kind' },
		});
		expect(await builder.emptyPayload('Example', { kind: 'bad' as never })).toMatchObject({
			ok: false,
			error: { code: 'invalid-kind' },
		});
		expect(await builder.buildPayload('Example', {}, { kind: 'bad' as never })).toMatchObject({
			ok: false,
			error: { code: 'invalid-kind' },
		});
		expect(await builder.buildCall('Example', {}, { messageId: 1 as never })).toMatchObject({
			ok: false,
			error: { code: 'invalid-message-id' },
		});
		const hostileMessageId = {
			get messageId(): never {
				throw new Error('messageId');
			},
		};
		expect(await builder.buildCall('Example', {}, hostileMessageId)).toMatchObject({
			ok: false,
			error: { code: 'invalid-message-id' },
		});
		expect(await builder.buildResult('Bad Action', {}, 'id')).toMatchObject({
			ok: false,
			error: { code: 'invalid-action' },
		});
		expect(await builder.buildResult('Example', {}, '')).toMatchObject({
			ok: false,
			error: { code: 'invalid-message-id' },
		});
		expect(builder.buildError('', 'InternalError', 'x')).toMatchObject({
			ok: false,
			error: { code: 'invalid-message-id' },
		});
		expect(builder.buildError('id', 'FormationViolation', 'x')).toMatchObject({
			ok: false,
			error: { code: 'invalid-error-code' },
		});
		expect(builder.buildError('id', 'InternalError', 1 as never)).toMatchObject({
			ok: false,
			error: { code: 'invalid-payload' },
		});
		expect(builder.buildError('id', 'InternalError', 'x', [] as never)).toMatchObject({
			ok: false,
			error: { code: 'invalid-payload' },
		});
		expect(builder.serialize([2, 'id'] as never)).toMatchObject({
			ok: false,
			error: { code: 'serialize-failed' },
		});
	});
});

describe('builder coverage: schema and actions', () => {
	it('rejects module namespaces and invalid schemas', async () => {
		const namespaced = builderFor({ __esModule: true, default: OBJECT });
		expect(await namespaced.fields('Example')).toMatchObject({
			ok: false,
			error: { code: 'schema-invalid' },
		});
		const invalid = builderFor(null);
		expect(await invalid.fields('Example')).toMatchObject({
			ok: false,
			error: { code: 'schema-invalid' },
		});
		const missingRef = builderFor({
			type: 'object',
			properties: { x: { $ref: '#/definitions/Missing' } },
		});
		expect(await missingRef.fields('Example')).toMatchObject({
			ok: false,
			error: { code: 'schema-invalid' },
		});
		const hostileSchema = {
			get type(): never {
				throw new Error('schema getter');
			},
		};
		expect(await builderFor(hostileSchema).fields('Example')).toMatchObject({
			ok: false,
			error: { code: 'schema-invalid' },
		});
		const revoked = Proxy.revocable({}, {});
		revoked.revoke();
		expect(await builderFor(revoked.proxy).fields('Example')).toMatchObject({
			ok: false,
			error: { code: 'schema-load-failed' },
		});
	});

	it('validates builder options', () => {
		expect(() => createBuilder({ version: '2.0.1', schemas: {} } as never)).toThrow('schemas.get');
		expect(() =>
			createBuilder({ version: '2.0.1', schemas: { get: () => OBJECT }, messageIds: 1 } as never),
		).toThrow('messageIds');
		expect(() =>
			createBuilder({ version: '2.0.1', schemas: { get: () => OBJECT }, examples: [] } as never),
		).toThrow('examples');
		expect(() =>
			createBuilder({
				version: '2.0.1',
				schemas: { get: () => OBJECT },
				schemaLimits: { maxNodes: 0 },
			} as never),
		).toThrow('schemaLimits.maxNodes');
	});

	it('handles action lists, has and examples', async () => {
		const fromOptions = builderFor(OBJECT, { actions: ['A', 'A'] });
		expect(await fromOptions.listActions()).toMatchObject({ ok: true, value: ['A'] });
		const asyncActions = builderFor(OBJECT, {
			actions: {
				async *[Symbol.asyncIterator]() {
					await Promise.resolve();
					yield 'A';
					yield 'B';
				},
			},
		});
		expect(await asyncActions.listActions()).toMatchObject({ ok: true, value: ['A', 'B'] });
		const badItem = builderFor(OBJECT, { actions: [1] });
		expect(await badItem.listActions()).toMatchObject({
			ok: false,
			error: { code: 'schema-load-failed' },
		});
		const nonIterable = builderFor(OBJECT, { actions: 1 });
		expect(await nonIterable.listActions()).toMatchObject({
			ok: false,
			error: { code: 'schema-load-failed' },
		});
		const throwingActions = builderFor(OBJECT, {
			schemas: {
				get: () => OBJECT,
				actions: () => {
					throw new Error('actions');
				},
			},
		});
		expect(await throwingActions.listActions()).toMatchObject({
			ok: false,
			error: { code: 'schema-load-failed' },
		});
		const loaderFailure = createBuilder({
			version: '2.0.1',
			schemas: {
				get: () => {
					throw new Error('loader');
				},
			},
		});
		expect(await loaderFailure.has('Example')).toMatchObject({
			ok: false,
			error: { code: 'schema-load-failed' },
		});
		const examples = builderFor(OBJECT, { examples: { Example: { value: 'x' } } });
		expect(examples.example('Example')).toMatchObject({ ok: true, value: { value: 'x' } });
		expect(examples.example('Missing')).toMatchObject({ ok: true, value: undefined });
		const badExample = builderFor(OBJECT, { examples: { Example: [] } });
		expect(badExample.example('Example')).toMatchObject({
			ok: false,
			error: { code: 'invalid-payload' },
		});
		const revokedExamples = Proxy.revocable({ Example: { value: 'x' } }, {});
		const hostileExamples = builderFor(OBJECT, { examples: revokedExamples.proxy });
		revokedExamples.revoke();
		expect(hostileExamples.example('Example')).toMatchObject({
			ok: false,
			error: { code: 'schema-load-failed' },
		});
	});
});

describe('builder coverage: roots, defaults, and actions', () => {
	it('handles boolean, const, and enum roots', async () => {
		expect(await builderFor(true).buildPayload('Example', {})).toMatchObject({ ok: true });
		expect(await builderFor(false).buildPayload('Example', {})).toMatchObject({
			ok: false,
			error: { code: 'invalid-payload' },
		});
		expect(await builderFor({ const: { a: 1 } }).buildPayload('Example', { a: 1 })).toMatchObject({
			ok: true,
		});
		expect(await builderFor(true).emptyPayload('Example')).toMatchObject({ ok: true });
		expect(await builderFor(false).emptyPayload('Example')).toMatchObject({
			ok: false,
			error: { code: 'invalid-payload' },
		});
		expect(await builderFor({ type: 'string' }).emptyPayload('Example')).toMatchObject({
			ok: false,
			error: { code: 'invalid-payload' },
		});
		expect(await builderFor({ const: 'x' }).emptyPayload('Example')).toMatchObject({
			ok: false,
			error: { code: 'invalid-payload' },
		});
		expect(await builderFor({ enum: ['x'] }).emptyPayload('Example')).toMatchObject({
			ok: false,
			error: { code: 'invalid-payload' },
		});
	});

	it('compares const arrays and objects by value', async () => {
		const builder = builderFor({
			type: 'object',
			required: ['fixed'],
			properties: {
				fixed: {
					const: {
						list: [1, { nested: true }],
						name: 'x',
					},
				},
			},
		});
		expect(
			await builder.buildPayload('Example', { fixed: { list: [1, { nested: true }], name: 'x' } }),
		).toMatchObject({ ok: true });
		expect(
			await builder.buildPayload('Example', { fixed: { list: [1, { nested: false }], name: 'x' } }),
		).toMatchObject({ ok: false, error: { code: 'invalid-enum' } });
		expect(
			await builder.buildPayload('Example', { fixed: { list: [1], name: 'x', extra: true } }),
		).toMatchObject({ ok: false, error: { code: 'invalid-enum' } });
	});

	it('rejects an unknown type keyword', async () => {
		const builder = builderFor({
			type: 'object',
			properties: { value: { type: 'custom' } },
		});
		expect(await builder.buildPayload('Example', { value: 'x' })).toMatchObject({
			ok: false,
			error: { code: 'invalid-type' },
		});
	});

	it('lists no actions and generates a default message ID', async () => {
		const builder = builderFor(OBJECT, { actions: undefined });
		expect(await builder.listActions()).toMatchObject({ ok: true, value: [] });

		const generated = createBuilder({
			version: '2.0.1',
			schemas: { get: () => OBJECT },
		});
		const result = await generated.buildCall('Example', { value: 'x' });
		expect(result.ok).toBe(true);
		if (!result.ok) return;
		expect(result.value[1]).toHaveLength(36);
	});

	it('keeps schema warnings and retries a rejected loader', async () => {
		const warned = builderFor({
			$schema: 'https://example.com/unknown-draft',
			type: 'object',
			properties: { value: { type: 'string' } },
		});
		const warnedResult = await warned.fields('Example');
		expect(warnedResult.ok).toBe(true);

		let attempts = 0;
		const rejecting = createBuilder({
			version: '2.0.1',
			schemas: {
				get: () => {
					attempts += 1;
					return attempts === 1 ? Promise.reject(new Error('transient')) : Promise.resolve(OBJECT);
				},
			},
		});
		expect(await rejecting.has('Example')).toMatchObject({
			ok: false,
			error: { code: 'schema-load-failed' },
		});
		expect(await rejecting.has('Example')).toMatchObject({ ok: true, value: true });
	});

	it('treats a hostile toStringTag as a non-module schema', async () => {
		const hostile = {
			get [Symbol.toStringTag](): never {
				throw new Error('tag');
			},
		};
		const result = await builderFor(hostile).fields('Example');
		expect(result.ok).toBe(true);
		if (result.ok) expect(result.value.path).toEqual([]);
	});

	it('rejects an invalid action on every entry point', async () => {
		const builder = builderFor(OBJECT);
		expect(await builder.emptyPayload('Bad Action')).toMatchObject({
			ok: false,
			error: { code: 'invalid-action' },
		});
		expect(await builder.buildPayload('Bad Action', {})).toMatchObject({
			ok: false,
			error: { code: 'invalid-action' },
		});
		expect(builder.example('Bad Action')).toMatchObject({
			ok: false,
			error: { code: 'invalid-action' },
		});
	});
});
