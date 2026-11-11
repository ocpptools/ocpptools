// SPDX-License-Identifier: Apache-2.0
// SPDX-FileCopyrightText: 2026 Rodolfo Carrillo

import { describe, expect, it } from 'vitest';

import {
	MESSAGE_TYPE,
	parseFrame,
	serializeFrame,
	type CallFrame,
	type JsonObject,
	type OcppVersion,
} from '@ocpptools/core';

import { MockCsmsCallError } from '../src/errors.js';
import { createFrameFactory } from '../src/frames/factory.js';
import { createMockCsms, type MockCsms, type MockCsmsOptions } from '../src/csms/mock-csms.js';
import {
	createInMemoryTransportPair,
	type InMemoryTransportPair,
} from '../src/transport/in-memory.js';

interface Setup {
	readonly pair: InMemoryTransportPair;
	readonly csms: MockCsms;
	readonly frames: ReturnType<typeof createFrameFactory>;
}

function setup(
	version: OcppVersion = '2.0.1',
	options: Partial<Omit<MockCsmsOptions, 'transport' | 'version'>> = {},
): Setup {
	const pair = createInMemoryTransportPair({ delivery: 'manual' });
	const csms = createMockCsms({ version, transport: pair.server, ...options });
	pair.link.open();
	return { pair, csms, frames: createFrameFactory({ version }) };
}

async function send(pair: InMemoryTransportPair, text: string): Promise<void> {
	pair.client.send(text);
	await pair.link.flush();
}

async function sendCall(
	setupValue: Setup,
	action = 'Example',
	payload: JsonObject = {},
): Promise<CallFrame> {
	const call = setupValue.frames.call(action, payload);
	await send(setupValue.pair, serializeText(call));
	return call;
}

function serializeText(frame: unknown): string {
	const result = serializeFrame(frame as never);
	if (!result.ok) throw new Error(result.error.message);
	return result.value;
}

function lastFrame(pair: InMemoryTransportPair, from: 'client' | 'server'): unknown {
	const source = from === 'client' ? pair.client : pair.server;
	const text = source.sent.at(-1);
	if (text === undefined) return undefined;
	const parsed = parseFrame(text);
	return parsed.ok ? parsed.value : undefined;
}

async function respondToServerCall(
	setupValue: Setup,
	payload: JsonObject = { value: 'ok' },
): Promise<CallFrame> {
	const parsed = parseFrame(setupValue.pair.client.received.at(-1) ?? '');
	if (!parsed.ok || parsed.value[0] !== MESSAGE_TYPE.CALL) {
		throw new Error('No inbound CALL');
	}
	await send(setupValue.pair, serializeText([MESSAGE_TYPE.CALLRESULT, parsed.value[1], payload]));
	return parsed.value;
}

describe('mock CSMS', () => {
	it('answers a CALL with a synchronous handler', async () => {
		const value = setup('2.0.1', { handlers: { Example: () => ({ value: 'ok' }) } });
		const call = await sendCall(value, 'Example', { value: 'x' });
		expect(value.csms.calls).toEqual([call]);
		expect(value.csms.results).toHaveLength(1);
		expect(value.csms.results[0]?.[1]).toBe(call[1]);
		expect(value.csms.results[0]?.[2]).toEqual({ value: 'ok' });
		expect(value.csms.pending).toEqual([]);
	});

	it('answers a CALL with an asynchronous handler', async () => {
		const value = setup('1.6', {
			handlers: {
				Example: () => Promise.resolve({ value: 'async' }),
			},
		});
		await sendCall(value);
		expect(lastFrame(value.pair, 'server')).toMatchObject([3, 'msg-1', { value: 'async' }]);
	});

	it('leaves a CALL pending when the handler returns undefined and responds manually', async () => {
		const value = setup('2.0.1', { handlers: { Example: () => undefined } });
		const call = await sendCall(value);
		expect(value.csms.pending).toEqual([call]);
		const waited = await value.csms.waitForCall('Example');
		value.csms.respond(waited, { value: 'manual' });
		await value.pair.link.flush();
		expect(value.csms.results[0]?.[2]).toEqual({ value: 'manual' });
		expect(value.csms.pending).toEqual([]);
	});

	it('answers {} for unknown actions only when autoRespond is empty', async () => {
		const empty = setup('2.0.1', { autoRespond: 'empty' });
		await sendCall(empty, 'Unknown');
		expect(empty.csms.results[0]?.[2]).toEqual({});

		const handlers = setup('2.0.1');
		await sendCall(handlers, 'Unknown');
		expect(handlers.csms.results).toEqual([]);
		expect(handlers.csms.pending).toHaveLength(1);
	});

	it('sends CALLERROR for a handler-thrown MockCsmsCallError', async () => {
		const value = setup('2.0.1', {
			handlers: {
				Example: () => {
					throw new MockCsmsCallError('InternalError', 'failed', { detail: true });
				},
			},
		});
		await sendCall(value);
		expect(value.csms.errors[0]).toEqual([
			MESSAGE_TYPE.CALLERROR,
			'msg-1',
			'InternalError',
			'failed',
			{ detail: true },
		]);
	});

	it('maps generic handler failures to InternalError and records an issue', async () => {
		const value = setup('2.0.1', {
			handlers: {
				Example: () => {
					throw new Error('boom');
				},
			},
		});
		await sendCall(value);
		expect(value.csms.errors[0]?.[2]).toBe('InternalError');
		expect(value.csms.issues.some((issue) => issue.code === 'handler-failed')).toBe(true);
	});

	it('sends InternalError when a handler returns non-JSON values', async () => {
		const value = setup('2.0.1', {
			handlers: {
				Example: () => ({ value: new Date() }) as never,
			},
		});
		await sendCall(value);
		expect(value.csms.errors[0]?.[2]).toBe('InternalError');
		expect(value.csms.issues.filter((issue) => issue.code === 'serialization-failed')).toHaveLength(
			1,
		);
		expect(value.csms.pending).toEqual([]);
	});

	it('sends InternalError when a handler error carries non-JSON details', async () => {
		const value = setup('2.0.1', {
			handlers: {
				Example: () => {
					throw new MockCsmsCallError('InternalError', 'bad details', {
						when: new Date(),
					} as never);
				},
			},
		});
		await sendCall(value);
		expect(value.csms.errors[0]?.[2]).toBe('InternalError');
		expect(value.csms.pending).toEqual([]);
	});

	it('resolves waitForIdle after stop even with an active handler', async () => {
		const value = setup('2.0.1', {
			handlers: {
				Example: () => new Promise<never>(() => undefined),
			},
		});
		await sendCall(value);
		const beforeStop = value.csms.waitForIdle();
		value.csms.stop();
		await expect(beforeStop).resolves.toBeUndefined();
		await expect(value.csms.waitForIdle()).resolves.toBeUndefined();
	});

	it('waits for slow async handlers with waitForIdle', async () => {
		const value = setup('2.0.1', {
			handlers: {
				Example: async () => {
					await new Promise<void>((resolve) => {
						void Promise.resolve().then(() => {
							void Promise.resolve().then(() => {
								void Promise.resolve().then(() => {
									void Promise.resolve().then(() => {
										resolve();
									});
								});
							});
						});
					});
					return { value: 'late' };
				},
			},
		});
		await sendCall(value);
		await value.csms.waitForIdle();
		expect(value.csms.results[0]?.[2]).toEqual({ value: 'late' });
	});

	it('maps invalid handler error codes to InternalError', async () => {
		const value = setup('1.6', {
			handlers: {
				Example: () => {
					throw new MockCsmsCallError('FormatViolation', 'wrong version');
				},
			},
		});
		await sendCall(value);
		expect(value.csms.errors[0]?.[2]).toBe('InternalError');
		expect(value.csms.issues.some((issue) => issue.code === 'unknown-error-code')).toBe(true);
	});

	it('allows invalid handler error codes when configured', async () => {
		const value = setup('1.6', {
			allowInvalidErrorCodes: true,
			handlers: {
				Example: () => {
					throw new MockCsmsCallError('FormatViolation', 'allowed');
				},
			},
		});
		await sendCall(value);
		expect(value.csms.errors[0]?.[2]).toBe('FormatViolation');
	});

	it('validates inbound CALLs before the handler', async () => {
		const invalid = setup('1.6', {
			validateCall: () => {
				throw new MockCsmsCallError('TypeConstraintViolation', 'bad payload');
			},
		});
		await sendCall(invalid);
		expect(invalid.csms.errors[0]?.[2]).toBe('TypeConstraintViolation');

		const generic = setup('2.0.1', {
			validateCall: () => {
				throw new Error('validator failed');
			},
		});
		await sendCall(generic);
		expect(generic.csms.errors[0]?.[2]).toBe('InternalError');
	});

	it('resolves server-initiated CALLs with CALLRESULT', async () => {
		const value = setup('2.0.1');
		const pending = value.csms.call('Example', { value: 'x' });
		await value.pair.link.flush();
		const call = await respondToServerCall(value, { value: 'answer' });
		await expect(pending).resolves.toEqual([3, call[1], { value: 'answer' }]);
		expect(value.csms.rawSent).toHaveLength(1);
	});

	it('rejects server-initiated CALLs with CALLERROR', async () => {
		const value = setup('2.0.1');
		const pending = value.csms.call('Example', {});
		await value.pair.link.flush();
		const parsed = parseFrame(value.pair.client.received[0] ?? '');
		if (!parsed.ok) throw new Error('No CALL');
		await send(
			value.pair,
			serializeText([MESSAGE_TYPE.CALLERROR, parsed.value[1], 'NotSupported', 'no', {}]),
		);
		await expect(pending).rejects.toMatchObject({
			code: 'NotSupported',
			origin: 'peer',
		});
	});

	it('correlates out-of-order responses', async () => {
		const value = setup('2.0.1');
		const first = value.csms.call('Example', { n: 1 });
		const second = value.csms.call('Example', { n: 2 });
		await value.pair.link.flush();
		const received = value.pair.client.received
			.map((text) => parseFrame(text))
			.filter(
				(result): result is { ok: true; value: CallFrame } => result.ok && result.value[0] === 2,
			)
			.map((result) => result.value);
		expect(received).toHaveLength(2);
		await send(value.pair, serializeText([3, received[1]?.[1] ?? '', { n: 2 }]));
		await send(value.pair, serializeText([3, received[0]?.[1] ?? '', { n: 1 }]));
		await expect(first).resolves.toMatchObject([3, received[0]?.[1], { n: 1 }]);
		await expect(second).resolves.toMatchObject([3, received[1]?.[1], { n: 2 }]);
	});

	it('rejects duplicate outbound message IDs and supports retry after failures', async () => {
		const value = setup('2.0.1');
		const pending = value.csms.call('Example', {}, { messageId: 'dup' });
		await expect(value.csms.call('Example', {}, { messageId: 'dup' })).rejects.toMatchObject({
			code: 'duplicate-message-id',
		});
		await value.pair.link.flush();
		await respondToServerCall(value);
		await expect(pending).resolves.toBeDefined();
	});

	it('rejects calls while connecting and after stop', async () => {
		const pair = createInMemoryTransportPair({ delivery: 'manual' });
		const csms = createMockCsms({ version: '2.0.1', transport: pair.server });
		await expect(csms.call('Example', {})).rejects.toMatchObject({ code: 'not-open' });
		pair.link.open();
		csms.stop();
		await expect(csms.call('Example', {})).rejects.toMatchObject({ code: 'closed' });
	});

	it('rejects creating a mock over a closed transport', () => {
		const pair = createInMemoryTransportPair({ delivery: 'manual' });
		pair.link.close();
		expect(() => createMockCsms({ version: '2.0.1', transport: pair.server })).toThrow(
			expect.objectContaining({ code: 'closed' }),
		);
	});

	it('cleans a failed outgoing call and allows retry with the same ID', async () => {
		const value = setup('2.0.1');
		value.pair.link.failNext('server-to-client', new Error('send failed'));
		await expect(value.csms.call('Example', {}, { messageId: 'retry' })).rejects.toMatchObject({
			code: 'send-failed',
		});
		expect(value.csms.sent).toEqual([]);
		const pending = value.csms.call('Example', {}, { messageId: 'retry' });
		await value.pair.link.flush();
		await respondToServerCall(value);
		await expect(pending).resolves.toBeDefined();
	});

	it('rejects a malformed response for a pending call', async () => {
		const value = setup('2.0.1');
		const pending = value.csms.call('Example', {});
		await value.pair.link.flush();
		await send(value.pair, '[3,"msg-1"]');
		await expect(pending).rejects.toMatchObject({ code: 'protocol' });
		expect(value.csms.issues.some((issue) => issue.code === 'parse-failed')).toBe(true);
	});

	it('replies to malformed CALLs with version-specific codes', async () => {
		const two = setup('2.0.1', { replyToInvalidFrames: true });
		await send(two.pair, '[2,"msg-1","Example"]');
		expect(two.csms.errors[0]?.[2]).toBe('FormatViolation');

		const one = setup('1.6', { replyToInvalidFrames: true });
		await send(one.pair, '[2,"msg-1","Example"]');
		expect(one.csms.errors[0]?.[2]).toBe('FormationViolation');
	});

	it('ignores unknown message types in both versions', async () => {
		// OCPP 2.0.1 Errata 2026-09 removed the extension fallback. An unknown
		// message type is ignored, not answered, even with replyToInvalidFrames.
		const two = setup('2.0.1', { replyToInvalidFrames: true });
		await send(two.pair, '[9,"msg-1"]');
		expect(two.csms.errors).toEqual([]);

		const one = setup('1.6', { replyToInvalidFrames: true });
		await send(one.pair, '[9,"msg-1"]');
		expect(one.csms.errors).toEqual([]);
	});

	it('never replies with CALLERROR to malformed CALLRESULT/CALLERROR', async () => {
		const value = setup('2.0.1', { replyToInvalidFrames: true });
		await send(value.pair, '[3,"msg-1"]');
		await send(value.pair, '[4,"msg-2"]');
		expect(value.csms.errors).toEqual([]);
	});

	it('records unknown inbound error codes and rejects the pending call', async () => {
		const value = setup('2.0.1');
		const pending = value.csms.call('Example', {});
		await value.pair.link.flush();
		await send(value.pair, '[4,"msg-1","NotARealCode","no",{}]');
		await expect(pending).rejects.toMatchObject({ code: 'NotARealCode', origin: 'peer' });
		expect(value.csms.issues.some((issue) => issue.code === 'unknown-error-code')).toBe(true);
	});

	it('validates server responses and rejects on validator failure', async () => {
		const value = setup('2.0.1', {
			validateResult: () => {
				throw new MockCsmsCallError('ProtocolError', 'bad result');
			},
		});
		const pending = value.csms.call('Example', {});
		await value.pair.link.flush();
		await respondToServerCall(value);
		await expect(pending).rejects.toMatchObject({ code: 'ProtocolError' });
		expect(value.csms.issues.some((issue) => issue.code === 'handler-failed')).toBe(true);

		const generic = setup('2.0.1', {
			validateResult: () => {
				throw new Error('validator failed');
			},
		});
		const genericPending = generic.csms.call('Example', {});
		await generic.pair.link.flush();
		await respondToServerCall(generic);
		await expect(genericPending).rejects.toMatchObject({ code: 'protocol' });
	});

	it('records unexpected responses and supports a successful manual reject', async () => {
		const value = setup('2.0.1');
		await send(value.pair, '[3,"unknown",{}]');
		expect(value.csms.issues.some((issue) => issue.code === 'unexpected-response')).toBe(true);

		const call = await sendCall(value);
		value.csms.reject(call, 'NotSupported', 'no');
		await value.pair.link.flush();
		expect(value.csms.errors[0]).toEqual([
			MESSAGE_TYPE.CALLERROR,
			call[1],
			'NotSupported',
			'no',
			{},
		]);
	});

	it('keeps a call pending when automatic or manual sending fails', async () => {
		const automatic = setup('2.0.1', { handlers: { Example: () => ({ value: 'ok' }) } });
		automatic.pair.link.failNext('server-to-client', new Error('send failed'));
		const call = await sendCall(automatic);
		expect(automatic.csms.pending).toEqual([call]);
		expect(automatic.csms.issues.some((issue) => issue.code === 'send-failed')).toBe(true);
		automatic.csms.respond(call, { value: 'retry' });
		await automatic.pair.link.flush();
		expect(automatic.csms.results[0]?.[2]).toEqual({ value: 'retry' });

		const manual = setup('2.0.1');
		const manualCall = await sendCall(manual);
		manual.pair.link.failNext('server-to-client', new Error('send failed'));
		expect(() => manual.csms.respond(manualCall, {})).toThrow(
			expect.objectContaining({ code: 'send-failed' }),
		);
		expect(manual.csms.pending).toEqual([manualCall]);
	});

	it('rejects unknown, duplicate and stopped manual responses', async () => {
		const value = setup('2.0.1');
		expect(() => value.csms.respond('missing', {})).toThrow(
			expect.objectContaining({ code: 'protocol' }),
		);
		const call = await sendCall(value);
		value.csms.respond(call, {});
		await value.pair.link.flush();
		expect(() => value.csms.respond(call, {})).toThrow(
			expect.objectContaining({ code: 'protocol' }),
		);
		const another = await sendCall(value, 'Other');
		value.csms.stop();
		expect(() => value.csms.respond(another, {})).toThrow(
			expect.objectContaining({ code: 'closed' }),
		);
	});

	it('rejects invalid error codes in manual reject and keeps the call pending', async () => {
		const value = setup('1.6');
		const call = await sendCall(value);
		expect(() => value.csms.reject(call, 'FormatViolation', 'wrong')).toThrow(
			expect.objectContaining({ code: 'protocol' }),
		);
		expect(value.csms.pending).toEqual([call]);
	});

	it('handles duplicate inbound message IDs and responds to the oldest', async () => {
		const value = setup('2.0.1');
		const call = await sendCall(value, 'Example', { n: 1 });
		value.pair.client.send(serializeText(call));
		await value.pair.link.flush();
		expect(value.csms.pending).toHaveLength(2);
		expect(value.csms.issues.some((issue) => issue.code === 'duplicate-message-id')).toBe(true);
		value.csms.respond(call[1], { first: true });
		await value.pair.link.flush();
		expect(value.csms.results[0]?.[2]).toEqual({ first: true });
		expect(value.csms.pending).toHaveLength(1);
	});

	it('does not resolve handlers through the object prototype', async () => {
		const value = setup('2.0.1');
		await sendCall(value, 'toString');
		expect(value.csms.results).toEqual([]);
		expect(value.csms.pending).toHaveLength(1);
	});

	it('keeps a call pending when a handler returns undefined even with autoRespond empty', async () => {
		const value = setup('2.0.1', {
			autoRespond: 'empty',
			handlers: { Example: () => undefined },
		});
		await sendCall(value);
		expect(value.csms.results).toEqual([]);
		expect(value.csms.pending).toHaveLength(1);
	});

	it('tracks raw and parsed logs and state transitions', async () => {
		const pair = createInMemoryTransportPair({ delivery: 'manual' });
		const csms = createMockCsms({
			version: '2.0.1',
			transport: pair.server,
			handlers: { Example: () => ({}) },
		});
		expect(csms.state).toBe('connecting');
		const issues: string[] = [];
		const observed = createMockCsms({
			version: '2.0.1',
			transport: createInMemoryTransportPair({ delivery: 'manual' }).server,
			onIssue: (issue) => issues.push(issue.code),
		});
		observed.stop();
		expect(issues).toContain('stopped');
		pair.link.open();
		expect(csms.state).toBe('open');
		await sendCall({ pair, csms, frames: createFrameFactory({ version: '2.0.1' }) });
		expect(csms.rawReceived).toHaveLength(1);
		expect(csms.rawSent).toHaveLength(1);
		expect(csms.received).toHaveLength(1);
		expect(csms.sent).toHaveLength(1);
		csms.stop();
		expect(csms.state).toBe('closed');
		csms.start();
		expect(csms.state).toBe('closed');
	});

	it('closes and rejects pending work when the transport closes', async () => {
		const value = setup('2.0.1');
		const pending = value.csms.call('Example', {});
		await value.pair.link.flush();
		value.pair.link.close();
		await expect(pending).rejects.toMatchObject({ code: 'closed' });
		expect(value.csms.state).toBe('closed');
		expect(value.csms.issues.some((issue) => issue.code === 'transport-closed')).toBe(true);

		const waiting = setup('2.0.1');
		const waiter = waiting.csms.waitForCall('Example');
		waiting.pair.link.close();
		await expect(waiter).rejects.toMatchObject({ code: 'closed' });
	});

	it('rejects invalid payloads and message ID generators', async () => {
		const value = setup('2.0.1');
		await expect(value.csms.call('Example', new Date() as never)).rejects.toMatchObject({
			code: 'serialization-failed',
		});
		expect(value.csms.issues.some((issue) => issue.code === 'serialization-failed')).toBe(true);
		await expect(value.csms.call('', {})).rejects.toMatchObject({ code: 'protocol' });

		const pair = createInMemoryTransportPair({ delivery: 'manual' });
		const csms = createMockCsms({
			version: '2.0.1',
			transport: pair.server,
			messageIds: () => {
				throw new Error('generator');
			},
		});
		pair.link.open();
		await expect(csms.call('Example', {})).rejects.toMatchObject({ code: 'protocol' });
	});

	it('records manual serialization failures and keeps the call pending', async () => {
		const value = setup('2.0.1');
		const call = await sendCall(value);
		expect(() => value.csms.respond(call, { value: new Date() } as never)).toThrow(
			expect.objectContaining({ code: 'serialization-failed' }),
		);
		expect(value.csms.pending).toEqual([call]);
		expect(value.csms.issues.filter((issue) => issue.code === 'serialization-failed')).toHaveLength(
			1,
		);
	});

	it('records each send or unknown-code issue once', async () => {
		const sendFailure = setup('2.0.1', { handlers: { Example: () => ({}) } });
		sendFailure.pair.link.failNext('server-to-client', new Error('send failed'));
		await sendCall(sendFailure);
		expect(sendFailure.csms.issues.filter((issue) => issue.code === 'send-failed')).toHaveLength(1);

		const unknownCode = setup('2.0.1');
		const pending = unknownCode.csms.call('Example', {});
		await unknownCode.pair.link.flush();
		await send(unknownCode.pair, '[4,"msg-1","NotARealCode","no",{}]');
		await expect(pending).rejects.toMatchObject({ code: 'NotARealCode' });
		expect(
			unknownCode.csms.issues.filter((issue) => issue.code === 'unknown-error-code'),
		).toHaveLength(1);
	});

	it('stores parsed copies in sent/results logs', async () => {
		const value = setup('2.0.1', { handlers: { Example: () => ({ value: 'ok' }) } });
		const payload = { value: 'original' };
		const pending = value.csms.call('Example', payload);
		await value.pair.link.flush();
		payload['value'] = 'mutated';
		expect(value.csms.sent[0]?.[3]).toEqual({ value: 'original' });
		await respondToServerCall(value);
		await expect(pending).resolves.toBeDefined();
	});
});
