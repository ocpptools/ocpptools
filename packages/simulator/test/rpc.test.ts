// SPDX-License-Identifier: Apache-2.0
// SPDX-FileCopyrightText: 2026 Rodolfo Carrillo

import { describe, expect, it } from 'vitest';

import type { OcppVersion } from '@ocpptools/core';

import { EventEmitter } from '../src/events.js';
import { History } from '../src/log.js';
import { Rpc } from '../src/rpc.js';
import { Scheduler } from '../src/clock.js';
import { SimulatorCallError } from '../src/errors.js';
import { FakeClock, flushMicrotasks } from './helpers/fake-clock.js';

interface Harness {
	readonly clock: FakeClock;
	readonly rpc: Rpc;
	readonly sent: string[];
	readonly history: History;
	readonly events: EventEmitter;
	open: boolean;
	failSend: boolean;
}

function createHarness(version: OcppVersion = '1.6', timeoutMs = 1000): Harness {
	const clock = new FakeClock();
	const scheduler = new Scheduler(clock);
	const sent: string[] = [];
	const history = new History();
	const events = new EventEmitter(() => clock.now());
	let sequence = 0;
	const harness: Harness = {
		clock,
		open: true,
		failSend: false,
		sent,
		history,
		events,
		rpc: new Rpc({
			version,
			scheduler,
			events,
			history,
			messageIds: () => `id-${++sequence}`,
			sendText: async (text) => {
				await Promise.resolve();
				if (harness.failSend) {
					throw new Error('wire down');
				}
				sent.push(text);
			},
			isOpen: () => harness.open,
			timeoutMs,
		}),
	};
	return harness;
}

describe('Rpc', () => {
	it('resolves a CALL with its CALLRESULT', async () => {
		const { rpc, sent, clock } = createHarness();
		const call = rpc.sendCall('Heartbeat', {});
		await flushMicrotasks();
		expect(sent).toEqual(['[2,"id-1","Heartbeat",{}]']);
		rpc.handleText('[3,"id-1",{"currentTime":"2026-01-01T00:00:00Z"}]');
		await expect(call).resolves.toEqual({ currentTime: '2026-01-01T00:00:00Z' });
		clock.advance(2000);
	});

	it('rejects a CALL with a structured CALLERROR', async () => {
		const { rpc } = createHarness();
		const call = rpc.sendCall('Heartbeat', {});
		await flushMicrotasks();
		rpc.handleText('[4,"id-1","NotSupported","no",{}]');
		await expect(call).rejects.toMatchObject({
			code: 'call-error',
			ocppErrorCode: 'NotSupported',
			errorDescription: 'no',
		});
	});

	it('times out a call and removes its timer', async () => {
		const { rpc, clock } = createHarness('1.6', 100);
		const call = rpc.sendCall('Heartbeat', {});
		await flushMicrotasks();
		const assertion = expect(call).rejects.toMatchObject({ code: 'timeout' });
		clock.advance(100);
		await assertion;
		expect(clock.pendingTimers).toBe(0);
	});

	it('rejects when the transport fails before send', async () => {
		const harness = createHarness();
		harness.failSend = true;
		const call = harness.rpc.sendCall('Heartbeat', {});
		await expect(call).rejects.toMatchObject({ code: 'send-failed' });
	});

	it('dispatches an inbound CALL and replies once', async () => {
		const { rpc, sent } = createHarness();
		rpc.onCall('Heartbeat', async (context) => {
			await context.reply({ status: 'ok' });
		});
		rpc.handleText('[2,"in-1","Heartbeat",{}]');
		await flushMicrotasks();
		expect(sent).toContain('[3,"in-1",{"status":"ok"}]');
	});

	it('answers an unknown action with NotImplemented', async () => {
		const { rpc, sent } = createHarness();
		rpc.handleText('[2,"in-1","MakeCoffee",{}]');
		await flushMicrotasks();
		expect(sent[0]).toContain('"NotImplemented"');
	});

	it('answers a handler failure with InternalError', async () => {
		const { rpc, sent } = createHarness();
		rpc.onCall('Heartbeat', () => {
			throw new Error('boom');
		});
		rpc.handleText('[2,"in-1","Heartbeat",{}]');
		await flushMicrotasks();
		expect(sent[0]).toContain('"InternalError"');
	});

	it('ignores a second reply and reports it', async () => {
		const { rpc, sent } = createHarness();
		let first: boolean | undefined;
		let second: boolean | undefined;
		rpc.onCall('Heartbeat', async (context) => {
			first = await context.reply({});
			second = await context.reply({});
		});
		rpc.handleText('[2,"in-1","Heartbeat",{}]');
		await flushMicrotasks();
		expect(first).toBe(true);
		expect(second).toBe(false);
		expect(sent.filter((entry) => entry.startsWith('[3,')).length).toBe(1);
	});

	it('answers a malformed CALL with the version code', async () => {
		const { rpc, sent } = createHarness('1.6');
		rpc.handleText('[2,"bad","Heartbeat",{},{}]');
		await flushMicrotasks();
		expect(sent[0]).toContain('"FormationViolation"');

		const modern = createHarness('2.0.1');
		modern.rpc.handleText('[2,"bad","Heartbeat",{},{}]');
		await flushMicrotasks();
		expect(modern.sent[0]).toContain('"FormatViolation"');
	});

	it('answers an unknown message type only in 2.0.1', async () => {
		const legacy = createHarness('1.6');
		legacy.rpc.handleText('[9,"id","Heartbeat",{}]');
		await flushMicrotasks();
		expect(legacy.sent).toEqual([]);

		const modern = createHarness('2.0.1');
		modern.rpc.handleText('[9,"id","Heartbeat",{}]');
		await flushMicrotasks();
		expect(modern.sent[0]).toContain('"MessageTypeNotSupported"');
	});

	it('preserves an unknown CALLERROR code and warns', async () => {
		const { rpc, sent } = createHarness('1.6');
		const call = rpc.sendCall('Heartbeat', {});
		await flushMicrotasks();
		sent.length = 0;
		rpc.handleText('[4,"id-1","FooError","bad",{}]');
		await expect(call).rejects.toBeInstanceOf(SimulatorCallError);
		await expect(call).rejects.toMatchObject({ ocppErrorCode: 'FooError' });
	});

	it('rejects duplicate generated IDs instead of overwriting pending calls', async () => {
		const clock = new FakeClock();
		const rpc = new Rpc({
			version: '1.6',
			scheduler: new Scheduler(clock),
			events: new EventEmitter(() => clock.now()),
			history: new History(),
			messageIds: () => 'same',
			sendText: async () => {
				await Promise.resolve();
			},
			isOpen: () => true,
		});
		void rpc.sendCall('Heartbeat', {});
		await expect(rpc.sendCall('Heartbeat', {})).rejects.toMatchObject({
			code: 'duplicate-message-id',
		});
	});

	it('reserves IDs away from pending calls', async () => {
		const clock = new FakeClock();
		const ids = ['same', 'same', 'fresh'];
		const rpc = new Rpc({
			version: '1.6',
			scheduler: new Scheduler(clock),
			events: new EventEmitter(() => clock.now()),
			history: new History(),
			messageIds: () => ids.shift() ?? 'later',
			sendText: async () => {
				await Promise.resolve();
			},
			isOpen: () => true,
		});
		const call = rpc.sendCall('Heartbeat', {});
		await flushMicrotasks();
		expect(rpc.getPending()[0]?.messageId).toBe('same');
		expect(rpc.reserveMessageId()).toBe('fresh');
		rpc.releaseMessageId('fresh');
		void call.catch(() => undefined);
		rpc.dispose();
	});

	it('does not reuse a canceled message ID', async () => {
		const clock = new FakeClock();
		const ids = ['same', 'same', 'fresh'];
		const rpc = new Rpc({
			version: '1.6',
			scheduler: new Scheduler(clock),
			events: new EventEmitter(() => clock.now()),
			history: new History(),
			messageIds: () => ids.shift() ?? 'later',
			sendText: async () => {
				await Promise.resolve();
			},
			isOpen: () => true,
		});
		const first = rpc.sendCall('Heartbeat', {});
		await flushMicrotasks();
		rpc.cancelAll('cleared', 'cancelled');
		await expect(first).rejects.toMatchObject({ code: 'cancelled' });
		const second = rpc.sendCall('Heartbeat', {});
		await flushMicrotasks();
		expect(rpc.getPending()[0]?.messageId).toBe('fresh');
		rpc.handleText('[3,"same",{"stale":true}]');
		await flushMicrotasks();
		expect(rpc.getPending()[0]?.messageId).toBe('fresh');
		void second.catch(() => undefined);
		rpc.dispose();
	});

	it('cancels pending calls and refuses work after dispose', async () => {
		const { rpc } = createHarness();
		const call = rpc.sendCall('Heartbeat', {});
		await flushMicrotasks();
		rpc.cancelAll('closed');
		await expect(call).rejects.toMatchObject({ code: 'disconnected' });
		rpc.dispose();
		await expect(rpc.sendCall('Heartbeat', {})).rejects.toMatchObject({ code: 'disposed' });
	});

	it('cancels with a caller code and consumes late replies', async () => {
		const harness = createHarness();
		const errors: string[] = [];
		harness.events.on('error', (event) => {
			errors.push(event.error.code);
		});
		const call = harness.rpc.sendCall('Heartbeat', {});
		const second = harness.rpc.sendCall('Heartbeat', {});
		await flushMicrotasks();
		harness.rpc.cancelAll('cleared', 'cancelled');
		await expect(call).rejects.toMatchObject({ code: 'cancelled' });
		await expect(second).rejects.toMatchObject({ code: 'cancelled' });
		harness.rpc.handleText('[3,"id-1",{}]');
		harness.rpc.handleText('[4,"id-2","NotSupported","late",{}]');
		await flushMicrotasks();
		expect(errors).not.toContain('invalid-response');
	});

	it('rejects invalid error codes per version', async () => {
		const { rpc } = createHarness('1.6');
		await expect(rpc.sendCallError('id', 'FormatViolation', 'no')).rejects.toMatchObject({
			code: 'invalid-error-code',
		});
	});

	it('allows the same message ID in both directions', async () => {
		const { rpc, sent } = createHarness();
		void rpc.sendCall('Heartbeat', {});
		rpc.onCall('StatusNotification', async (context) => {
			await context.reply({});
		});
		rpc.handleText('[2,"id-1","StatusNotification",{}]');
		await flushMicrotasks();
		expect(sent.some((entry) => entry.startsWith('[3,"id-1"'))).toBe(true);
	});

	it('marks a public sendCallResult as the single inbound reply', async () => {
		const { rpc, sent } = createHarness();
		rpc.onCall('Heartbeat', async (context) => {
			await rpc.sendCallResult(context.messageId, { status: 'ok' });
		});
		rpc.handleText('[2,"in-1","Heartbeat",{}]');
		await flushMicrotasks();
		expect(sent).toContain('[3,"in-1",{"status":"ok"}]');
		expect(sent.some((entry) => entry.includes('InternalError'))).toBe(false);
	});

	it('answers an async handler rejection with InternalError', async () => {
		const { rpc, sent } = createHarness();
		rpc.onCall('Heartbeat', () => Promise.reject(new Error('async boom')));
		rpc.handleText('[2,"in-1","Heartbeat",{}]');
		await flushMicrotasks();
		expect(sent[0]).toContain('"InternalError"');
	});

	it('settles a pending call when a response frame is malformed', async () => {
		const { rpc } = createHarness();
		const call = rpc.sendCall('Heartbeat', {});
		await flushMicrotasks();
		rpc.handleText('[3,"id-1",[],{}]');
		await expect(call).rejects.toMatchObject({ code: 'invalid-response' });
	});

	it('rejects a call cancelled after send started', async () => {
		const { rpc } = createHarness();
		const call = rpc.sendCall('Heartbeat', {});
		rpc.reset('disconnected');
		await expect(call).rejects.toMatchObject({ code: 'disconnected' });
		await flushMicrotasks();
	});

	it('keeps an active inbound handler alive when a duplicate CALL arrives', async () => {
		const { rpc, sent } = createHarness();
		let release: (() => void) | undefined;
		const gate = new Promise<void>((resolve) => {
			release = resolve;
		});
		rpc.onCall('Heartbeat', async (context) => {
			await gate;
			await context.reply({ status: 'original' });
		});
		rpc.handleText('[2,"dup","Heartbeat",{}]');
		await flushMicrotasks();
		rpc.handleText('[2,"dup","Heartbeat",{}]');
		await flushMicrotasks();
		expect(sent.some((entry) => entry.includes('ProtocolError'))).toBe(true);
		release?.();
		await flushMicrotasks();
		expect(sent.some((entry) => entry.includes('original'))).toBe(true);
	});

	it('blocks a public reply after the context has replied', async () => {
		const { rpc, sent } = createHarness();
		rpc.onCall('Heartbeat', async (context) => {
			await context.reply({ status: 'first' });
			await rpc.sendCallResult(context.messageId, { status: 'second' });
		});
		rpc.handleText('[2,"in-1","Heartbeat",{}]');
		await flushMicrotasks();
		expect(sent.filter((entry) => entry.startsWith('[3,')).length).toBe(1);
	});

	it('records raw frames in history and validates the version', async () => {
		const { rpc, history } = createHarness();
		await rpc.sendRawFrame([2, 'raw-1', 'Heartbeat', {}]);
		expect(history.get().some((entry) => entry.messageId === 'raw-1')).toBe(true);
		expect(
			() =>
				new Rpc({
					version: '9.9' as OcppVersion,
					scheduler: new Scheduler(new FakeClock()),
					events: new EventEmitter(() => 0),
					history: new History(),
					messageIds: () => 'x',
					sendText: () => Promise.resolve(),
					isOpen: () => true,
				}),
		).toThrow('Unsupported OCPP version');
	});
});
