// SPDX-License-Identifier: Apache-2.0
// SPDX-FileCopyrightText: 2026 Rodolfo Carrillo

import { describe, expect, it, vi } from 'vitest';

import type { SchemaRegistry } from '../src/types.js';
import { createValidator } from '../src/validator.js';

const requestSchema = {
	type: 'object',
	required: ['idTag'],
	properties: { idTag: { type: 'string' } },
};

const responseSchema = {
	type: 'object',
	required: ['status'],
	properties: { status: { type: 'string' } },
};

function schemasFor(action = 'Heartbeat'): SchemaRegistry {
	return {
		get: (requested, kind) =>
			requested === action ? (kind === 'request' ? requestSchema : responseSchema) : undefined,
	};
}

describe('validateFrame', () => {
	it('validates a CALL frame that is already parsed', async () => {
		const validator = createValidator({ version: '2.0.1', schemas: schemasFor() });

		await expect(
			validator.validateFrame([2, 'id-1', 'Heartbeat', { idTag: 'abc' }]),
		).resolves.toEqual({
			status: 'valid',
			valid: true,
			messageType: 2,
			messageId: 'id-1',
			action: 'Heartbeat',
			issues: [],
			warnings: [],
		});
	});

	it('validates a CALL frame given as JSON text', async () => {
		const validator = createValidator({ version: '2.0.1', schemas: schemasFor() });
		const text = JSON.stringify([2, 'id-1', 'Heartbeat', { idTag: 'abc' }]);

		const parsed = await validator.validateFrame([2, 'id-1', 'Heartbeat', { idTag: 'abc' }]);
		const fromText = await validator.validateFrame(text);
		expect(fromText).toEqual(parsed);
	});

	it('prefixes payload violations with the frame index', async () => {
		const validator = createValidator({ version: '2.0.1', schemas: schemasFor() });

		const result = await validator.validateFrame([2, 'id-1', 'Heartbeat', { idTag: 1 }]);
		expect(result).toMatchObject({
			status: 'invalid-payload',
			valid: false,
			messageType: 2,
			messageId: 'id-1',
			action: 'Heartbeat',
		});
		expect(result.issues[0]).toMatchObject({
			code: 'schema-violation',
			keyword: 'type',
			path: [3, 'idTag'],
			pointer: '/3/idTag',
			received: '1',
		});
	});

	it('treats a non-object payload as an invalid frame', async () => {
		const get = vi.fn<SchemaRegistry['get']>(() => requestSchema);
		const validator = createValidator({ version: '2.0.1', schemas: { get } });

		const result = await validator.validateFrame([2, 'id-1', 'Heartbeat', []]);
		expect(result.status).toBe('invalid-frame');
		expect(result.valid).toBe(false);
		expect(result.issues[0]).toMatchObject({
			code: 'invalid-payload',
			path: [3],
			pointer: '/3',
		});
		expect(get).not.toHaveBeenCalled();
	});

	it('reports an unknown action without treating the frame as invalid', async () => {
		const validator = createValidator({ version: '2.0.1', schemas: schemasFor('Other') });

		const result = await validator.validateFrame([2, 'id-1', 'Heartbeat', { idTag: 'abc' }]);
		expect(result).toMatchObject({
			status: 'unknown-action',
			valid: false,
			messageType: 2,
			messageId: 'id-1',
			action: 'Heartbeat',
			issues: [],
		});
	});

	it('reports a schema problem without prefixing its path', async () => {
		const validator = createValidator({
			version: '2.0.1',
			schemas: {
				get: () => null,
			},
		});

		const result = await validator.validateFrame([2, 'id-1', 'Heartbeat', { idTag: 'abc' }]);
		expect(result.status).toBe('schema-missing');
		expect(result.issues[0]).toMatchObject({
			code: 'schema-invalid',
			path: [],
			pointer: '',
		});
	});

	it('reports invalid JSON without exposing its text', async () => {
		const validator = createValidator({ version: '2.0.1', schemas: schemasFor() });
		const secret = 'SECRET';

		const result = await validator.validateFrame(`{"secret":"${secret}"`);
		expect(result).toMatchObject({
			status: 'invalid-frame',
			valid: false,
			issues: [
				{
					code: 'invalid-json',
					path: [],
					pointer: '',
					message: 'The input is not valid JSON',
				},
			],
			warnings: [],
		});
		expect(JSON.stringify(result)).not.toContain(secret);
	});

	it('reports a non-array input as an invalid frame', async () => {
		const validator = createValidator({ version: '2.0.1', schemas: schemasFor() });

		const result = await validator.validateFrame({ type: 'not-a-frame' });
		expect(result.status).toBe('invalid-frame');
		expect(result.issues[0]).toMatchObject({ code: 'not-array', path: [] });
	});

	it('keeps message identity and warnings from a structurally invalid frame', async () => {
		const validator = createValidator({ version: '2.0.1', schemas: schemasFor() });
		const longId = 'x'.repeat(37);

		const result = await validator.validateFrame([2, longId, 'Heartbeat']);
		expect(result).toMatchObject({
			status: 'invalid-frame',
			valid: false,
			messageType: 2,
			messageId: longId,
			action: 'Heartbeat',
		});
		expect(result.issues.map((issue) => issue.code)).toEqual(['wrong-length', 'invalid-payload']);
		expect(result.warnings[0]).toMatchObject({
			code: 'long-message-id',
			path: [1],
			pointer: '/1',
		});
	});

	it('keeps the long message ID warning on a valid frame', async () => {
		const validator = createValidator({ version: '2.0.1', schemas: schemasFor() });
		const longId = 'x'.repeat(37);

		const result = await validator.validateFrame([2, longId, 'Heartbeat', { idTag: 'abc' }]);
		expect(result.status).toBe('valid');
		expect(result.warnings).toHaveLength(1);
		expect(result.warnings[0]).toMatchObject({
			code: 'long-message-id',
			path: [1],
			pointer: '/1',
		});
	});

	it('keeps frame warnings when the payload is invalid', async () => {
		const validator = createValidator({ version: '2.0.1', schemas: schemasFor() });
		const longId = 'x'.repeat(37);

		const result = await validator.validateFrame([2, longId, 'Heartbeat', { idTag: 1 }]);
		expect(result.status).toBe('invalid-payload');
		expect(result.warnings[0]?.code).toBe('long-message-id');
	});

	it('returns a warning for a CALLRESULT without its request action', async () => {
		const get = vi.fn<SchemaRegistry['get']>(() => responseSchema);
		const validator = createValidator({ version: '2.0.1', schemas: { get } });

		const result = await validator.validateFrame([3, 'id-1', { status: 'ok' }]);
		expect(result).toMatchObject({
			status: 'valid',
			valid: true,
			messageType: 3,
			messageId: 'id-1',
			issues: [],
		});
		expect(result.warnings[0]).toMatchObject({
			code: 'unchecked-result',
			path: [2],
			pointer: '/2',
		});
		expect(get).not.toHaveBeenCalled();
	});

	it('validates a CALLRESULT against its request action', async () => {
		const get = vi.fn<SchemaRegistry['get']>(() => responseSchema);
		const validator = createValidator({ version: '2.0.1', schemas: { get } });

		const result = await validator.validateFrame([3, 'id-1', { status: 'ok' }], {
			requestAction: 'Heartbeat',
		});
		expect(result).toMatchObject({
			status: 'valid',
			valid: true,
			messageType: 3,
			messageId: 'id-1',
			action: 'Heartbeat',
			issues: [],
			warnings: [],
		});
		expect(get).toHaveBeenCalledWith('Heartbeat', 'response');
	});

	it('prefixes CALLRESULT payload violations with the frame index', async () => {
		const validator = createValidator({ version: '2.0.1', schemas: schemasFor() });

		const result = await validator.validateFrame([3, 'id-1', { status: 1 }], {
			requestAction: 'Heartbeat',
		});
		expect(result.status).toBe('invalid-payload');
		expect(result.issues[0]).toMatchObject({
			keyword: 'type',
			path: [2, 'status'],
			pointer: '/2/status',
		});
	});

	it('treats an empty or non-string requestAction as absent', async () => {
		const get = vi.fn<SchemaRegistry['get']>(() => responseSchema);
		const validator = createValidator({ version: '2.0.1', schemas: { get } });

		const empty = await validator.validateFrame([3, 'id-1', {}], { requestAction: '' });
		const number = await validator.validateFrame([3, 'id-1', {}], {
			requestAction: 42 as unknown as string,
		});
		expect(empty.warnings[0]?.code).toBe('unchecked-result');
		expect(number.warnings[0]?.code).toBe('unchecked-result');
		expect(get).not.toHaveBeenCalled();
	});

	it('treats hostile options as absent', async () => {
		const validator = createValidator({ version: '2.0.1', schemas: schemasFor() });
		const { proxy, revoke } = Proxy.revocable({}, {});
		revoke();

		const result = await validator.validateFrame([3, 'id-1', {}], proxy);
		expect(result.status).toBe('valid');
		expect(result.warnings[0]?.code).toBe('unchecked-result');
	});

	it('reports a schema load failure through a frame', async () => {
		const get = vi.fn<SchemaRegistry['get']>(() => Promise.reject(new Error('down')));
		const validator = createValidator({ version: '2.0.1', schemas: { get } });

		const result = await validator.validateFrame([2, 'id-1', 'Heartbeat', { idTag: 'abc' }]);
		expect(result).toMatchObject({
			status: 'schema-missing',
			valid: false,
			messageType: 2,
			messageId: 'id-1',
			action: 'Heartbeat',
		});
		expect(result.issues[0]).toMatchObject({
			code: 'schema-load-failed',
			path: [],
			pointer: '',
		});
	});

	it('reports an unknown response action and a response schema failure', async () => {
		const unknown = createValidator({
			version: '2.0.1',
			schemas: { get: () => undefined },
		});
		const unknownResult = await unknown.validateFrame([3, 'id-1', {}], {
			requestAction: 'Nope',
		});
		expect(unknownResult).toMatchObject({
			status: 'unknown-action',
			action: 'Nope',
			messageType: 3,
			messageId: 'id-1',
			issues: [],
		});

		const failing = createValidator({
			version: '2.0.1',
			schemas: { get: () => Promise.reject(new Error('down')) },
		});
		const failedResult = await failing.validateFrame([3, 'id-1', {}], {
			requestAction: 'Heartbeat',
		});
		expect(failedResult).toMatchObject({
			status: 'schema-missing',
			action: 'Heartbeat',
			messageType: 3,
			messageId: 'id-1',
		});
		expect(failedResult.issues[0]?.code).toBe('schema-load-failed');
	});

	it('keeps warning order: frame warning, then unchecked result', async () => {
		const validator = createValidator({ version: '2.0.1', schemas: schemasFor() });
		const longId = 'x'.repeat(37);

		const result = await validator.validateFrame([3, longId, {}]);
		expect(result.warnings.map((warning) => warning.code)).toEqual([
			'long-message-id',
			'unchecked-result',
		]);
	});

	it('prefixes escaped and nested payload paths', async () => {
		const schema = {
			type: 'object',
			required: ['id'],
			properties: {
				id: { type: 'string' },
				'a/b': { type: 'string' },
				'a~b': { type: 'string' },
				tags: { type: 'array', items: { type: 'string' } },
			},
		};
		const validator = createValidator({
			version: '2.0.1',
			schemas: { get: () => schema },
		});

		const result = await validator.validateFrame([
			2,
			'id-1',
			'Heartbeat',
			{ 'a/b': 1, 'a~b': 2, tags: ['ok', 3] },
		]);
		expect(result.status).toBe('invalid-payload');
		const pointers = result.issues.map((issue) => issue.pointer);
		expect(pointers).toEqual(expect.arrayContaining(['/3/id', '/3/a~1b', '/3/a~0b', '/3/tags/1']));
		expect(result.issues.find((issue) => issue.pointer === '/3/tags/1')?.path).toEqual([
			3,
			'tags',
			1,
		]);
	});

	it('does not treat index 2 as an action outside CALL', async () => {
		const validator = createValidator({ version: '2.0.1', schemas: schemasFor() });
		const frames: unknown[] = [
			[4, 'id-1', 'Nope', 'text', {}],
			[3, 'id-1', 'oops', 'extra'],
			[9, 'id-1', 'Heartbeat', {}],
		];

		for (const frame of frames) {
			const result = await validator.validateFrame(frame);
			expect(result.status).toBe('invalid-frame');
			expect(result.action).toBeUndefined();
		}
	});

	it('validates representative CALLERROR codes from both versions', async () => {
		const cases: ['1.6' | '2.0.1', string, string][] = [
			['1.6', 'OccurenceConstraintViolation', 'valid'],
			['2.0.1', 'OccurrenceConstraintViolation', 'valid'],
			['2.0.1', 'FormatViolation', 'valid'],
			['2.0.1', 'MessageTypeNotSupported', 'valid'],
			['2.0.1', 'RpcFrameworkError', 'valid'],
			['1.6', 'FormatViolation', 'invalid-frame'],
			['2.0.1', 'OccurenceConstraintViolation', 'invalid-frame'],
		];

		for (const [version, code, status] of cases) {
			const validator = createValidator({ version, schemas: schemasFor() });
			const result = await validator.validateFrame([4, 'id-1', code, 'text', {}]);
			expect(result.status).toBe(status);
		}
	});

	it('validates a CALLERROR with the version-specific code set', async () => {
		const validator16 = createValidator({ version: '1.6', schemas: schemasFor() });
		const validator201 = createValidator({ version: '2.0.1', schemas: schemasFor() });

		await expect(
			validator16.validateFrame([4, 'id-1', 'FormationViolation', 'text', {}]),
		).resolves.toMatchObject({
			status: 'valid',
			valid: true,
			messageType: 4,
			messageId: 'id-1',
			issues: [],
		});
		const invalid = await validator201.validateFrame([4, 'id-1', 'FormationViolation', 'text', {}]);
		expect(invalid.status).toBe('invalid-frame');
		expect(invalid.issues[0]).toMatchObject({
			code: 'unknown-error-code',
			path: [2],
			pointer: '/2',
		});
	});

	it('reports invalid CALLERROR fields', async () => {
		const validator = createValidator({ version: '2.0.1', schemas: schemasFor() });

		const result = await validator.validateFrame([4, 'id-1', 1, 2, []]);
		expect(result.status).toBe('invalid-frame');
		expect(result.action).toBeUndefined();
		expect(result.issues.map((issue) => issue.path)).toEqual([[2], [3], [4]]);
		expect(result.issues.map((issue) => issue.code)).toEqual([
			'invalid-error-code',
			'invalid-error-description',
			'invalid-error-details',
		]);
	});

	it('does not call the registry for invalid frames or CALLERROR', async () => {
		const get = vi.fn<SchemaRegistry['get']>(() => requestSchema);
		const validator = createValidator({ version: '2.0.1', schemas: { get } });

		await validator.validateFrame([2, 'id-1', '', {}]);
		await validator.validateFrame([3, 'id-1', {}]);
		await validator.validateFrame([4, 'id-1', 'GenericError', 'text', {}]);
		expect(get).not.toHaveBeenCalled();
	});

	it('caches a request schema across frames', async () => {
		const get = vi.fn<SchemaRegistry['get']>(() => requestSchema);
		const validator = createValidator({ version: '2.0.1', schemas: { get } });
		const frame = [2, 'id-1', 'Heartbeat', { idTag: 'abc' }];

		await validator.validateFrame(frame);
		await validator.validateFrame([2, 'id-2', 'Heartbeat', { idTag: 'def' }]);
		expect(get).toHaveBeenCalledTimes(1);
		expect(get).toHaveBeenCalledWith('Heartbeat', 'request');
	});

	it('returns an invalid-frame result for an unreadable parsed input', async () => {
		const validator = createValidator({ version: '2.0.1', schemas: schemasFor() });
		const { proxy, revoke } = Proxy.revocable([], {});
		revoke();

		const result = await validator.validateFrame(proxy);
		expect(result.status).toBe('invalid-frame');
		expect(result.issues[0]?.code).toBe('not-array');
	});

	it('does not mutate a frozen frame or payload', async () => {
		const validator = createValidator({ version: '2.0.1', schemas: schemasFor() });
		const payload = Object.freeze({ idTag: 'abc' });
		const frame = Object.freeze([2, 'id-1', 'Heartbeat', payload]);

		const result = await validator.validateFrame(frame);
		expect(result.status).toBe('valid');
		expect(frame).toEqual([2, 'id-1', 'Heartbeat', { idTag: 'abc' }]);
	});

	it('maps the frame issue codes to the public issue model', async () => {
		const validator = createValidator({ version: '2.0.1', schemas: schemasFor() });
		const cases: [unknown, string][] = [
			[[], 'empty-frame'],
			[[9, 'id'], 'unknown-message-type'],
			[[2, '', 'Heartbeat', {}], 'invalid-message-id'],
			[[2, 'id', '', {}], 'invalid-action'],
			[[2, 'id', 'Heartbeat'], 'wrong-length'],
		];

		for (const [frame, code] of cases) {
			const result = await validator.validateFrame(frame);
			expect(result.status).toBe('invalid-frame');
			expect(result.issues.map((issue) => issue.code)).toContain(code);
		}
	});
});
