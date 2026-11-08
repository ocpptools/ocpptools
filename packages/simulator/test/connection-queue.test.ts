// SPDX-License-Identifier: Apache-2.0
// SPDX-FileCopyrightText: 2026 Rodolfo Carrillo

import { describe, expect, it } from 'vitest';

import { Connection } from '../src/connection.js';
import { EventEmitter } from '../src/events.js';
import { OfflineQueue } from '../src/queue.js';
import { Scheduler } from '../src/clock.js';
import { SimulatorError } from '../src/errors.js';
import { FakeClock } from './helpers/fake-clock.js';
import { FakeTransportFactory } from './helpers/fake-transport.js';

function connectionHarness(reconnect = {}, clock = new FakeClock()) {
	const scheduler = new Scheduler(clock);
	const events = new EventEmitter(() => clock.now());
	const factory = new FakeTransportFactory();
	const messages: string[] = [];
	const connection = new Connection({
		url: 'ws://localhost/CP001',
		subprotocol: 'ocpp1.6',
		transportFactory: factory.factory,
		scheduler,
		events,
		reconnect,
		connectTimeoutMs: 15_000,
		onMessage: (text) => messages.push(text),
	});
	return { clock, scheduler, events, factory, messages, connection };
}

describe('Connection', () => {
	it('opens one transport and resets the attempt on open', () => {
		const { connection, factory } = connectionHarness();
		connection.connect();
		expect(connection.getState().state).toBe('connecting');
		expect(factory.transports).toHaveLength(1);
		factory.transports[0]?.open();
		expect(connection.isOpen()).toBe(true);
		expect(connection.getState()).toMatchObject({ state: 'connected', attempt: 0 });
		connection.disconnect();
		expect(connection.getState().state).toBe('disconnected');
	});

	it('does not reconnect after a clean close', () => {
		const { connection, factory, clock } = connectionHarness();
		connection.connect();
		factory.transports[0]?.open();
		factory.transports[0]?.close(1000, 'done');
		clock.advance(60_000);
		expect(factory.transports).toHaveLength(1);
		expect(connection.getState().state).toBe('disconnected');
	});

	it('reconnects with exponential delays and a new transport', () => {
		const { connection, factory, clock } = connectionHarness({ maxAttempts: 3 });
		connection.connect();
		factory.transports[0]?.open();
		factory.transports[0]?.close(1006, 'lost');
		expect(connection.getState()).toMatchObject({ state: 'reconnecting', retryInMs: 1000 });
		clock.advance(999);
		expect(factory.transports).toHaveLength(1);
		clock.advance(1);
		expect(factory.transports).toHaveLength(2);
		factory.transports[1]?.open();
		expect(connection.isOpen()).toBe(true);
		factory.transports[1]?.close(1006, 'lost again');
		expect(connection.getState().retryInMs).toBe(1000);
	});

	it('stops after the maximum number of consecutive retries', () => {
		const { connection, factory, clock, events } = connectionHarness({ maxAttempts: 1 });
		const errors: string[] = [];
		events.on('error', (event) => {
			errors.push(event.error.code);
		});
		connection.connect();
		factory.transports[0]?.open();
		factory.transports[0]?.close(1006, 'lost');
		clock.advance(1000);
		expect(factory.transports).toHaveLength(2);
		factory.transports[1]?.close(1006, 'lost');
		expect(connection.getState().state).toBe('disconnected');
		expect(errors).toContain('connection-failed');
		clock.advance(60_000);
		expect(factory.transports).toHaveLength(2);
	});

	it('cancels a pending reconnect when connect is called manually', () => {
		const { connection, factory, clock } = connectionHarness();
		connection.connect();
		factory.transports[0]?.open();
		factory.transports[0]?.close(1006, 'lost');
		clock.advance(500);
		connection.connect();
		expect(factory.transports).toHaveLength(2);
		expect(connection.getState().state).toBe('connecting');
	});

	it('closes a connecting transport on manual disconnect', () => {
		const { connection, factory, clock } = connectionHarness();
		connection.connect();
		const transport = factory.transports[0];
		connection.disconnect();
		expect(transport?.closeCalls).toEqual([{ code: 1000, reason: 'Client disconnect' }]);
		clock.advance(60_000);
		expect(factory.transports).toHaveLength(1);
		expect(connection.getState().state).toBe('disconnected');
	});

	it('times out a transport that never opens and retries', () => {
		const { connection, factory, clock } = connectionHarness({ maxAttempts: 2 });
		connection.connect();
		clock.advance(15_000);
		expect(factory.transports[0]?.closeCalls[0]?.code).toBe(1000);
		clock.advance(1000);
		expect(factory.transports).toHaveLength(2);
		expect(connection.getState().state).toBe('connecting');
	});

	it('ignores messages from an old transport', () => {
		const { connection, factory, clock, messages } = connectionHarness();
		connection.connect();
		const first = factory.transports[0];
		first?.open();
		first?.receive('first');
		first?.close(1006, 'lost');
		clock.advance(1000);
		expect(factory.transports).toHaveLength(2);
		first?.receive('stale');
		factory.transports[1]?.open();
		factory.transports[1]?.receive('second');
		expect(messages).toEqual(['first', 'second']);
	});

	it('rejects sends while not open and wraps transport failures', () => {
		const { connection, factory } = connectionHarness();
		expect(() => connection.sendText('x')).toThrow('The transport is not open');
		connection.connect();
		factory.transports[0]?.open();
		factory.transports[0]!.send = () => {
			throw new Error('wire');
		};
		expect(() => connection.sendText('x')).toThrow('The transport rejected the frame');
	});

	it('stops in disconnected when the factory fails and reconnect is disabled', () => {
		const { connection, factory, clock } = connectionHarness({ enabled: false });
		factory.fail = true;
		connection.connect();
		expect(connection.getState().state).toBe('disconnected');
		clock.advance(60_000);
		expect(factory.transports).toHaveLength(0);
	});

	it('clears retry state on dispose during backoff', () => {
		const { connection, factory, clock } = connectionHarness();
		connection.connect();
		factory.transports[0]?.open();
		factory.transports[0]?.close(1006, 'lost');
		connection.dispose();
		expect(connection.getState()).toMatchObject({ state: 'disconnected' });
		expect(connection.getState().retryInMs).toBeUndefined();
		clock.advance(60_000);
		expect(factory.transports).toHaveLength(1);
	});

	it('reschedules an active backoff when reconnect options change', () => {
		const { connection, factory, clock } = connectionHarness();
		connection.connect();
		factory.transports[0]?.open();
		factory.transports[0]?.close(1006, 'lost');
		expect(connection.getState().retryInMs).toBe(1000);
		connection.setReconnectOptions({ baseDelayMs: 5000, maxDelayMs: 5000 });
		expect(connection.getState()).toMatchObject({ retryInMs: 5000 });
		clock.advance(4999);
		expect(factory.transports).toHaveLength(1);
		clock.advance(1);
		expect(factory.transports).toHaveLength(2);
	});

	it('cancels the backoff when a listener disables reconnect', () => {
		const { connection, factory, clock, events } = connectionHarness();
		let disabled = false;
		events.on('connection', (event) => {
			if (event.state === 'reconnecting' && !disabled) {
				disabled = true;
				connection.setReconnectOptions({ enabled: false });
			}
		});
		connection.connect();
		factory.transports[0]?.open();
		factory.transports[0]?.close(1006, 'lost');
		expect(connection.getState().state).toBe('disconnected');
		expect(connection.getState().retryInMs).toBeUndefined();
		clock.advance(60_000);
		expect(factory.transports).toHaveLength(1);
	});

	it('stops when the lowered attempt limit is already reached', () => {
		const { connection, factory, clock, events } = connectionHarness({ maxAttempts: 3 });
		const errors: string[] = [];
		events.on('error', (event) => {
			errors.push(event.error.code);
		});
		connection.connect();
		factory.transports[0]?.open();
		factory.transports[0]?.close(1006, 'lost');
		connection.setReconnectOptions({ maxAttempts: 1 });
		expect(connection.getState().state).toBe('disconnected');
		expect(errors).toContain('connection-failed');
		clock.advance(60_000);
		expect(factory.transports).toHaveLength(1);
	});

	it('does not stay reconnecting when the backoff timer cannot be scheduled', () => {
		const clock = new FakeClock();
		const original = clock.setTimeout.bind(clock);
		let calls = 0;
		clock.setTimeout = (callback, delayMs) => {
			calls += 1;
			if (calls > 1) throw new Error('timer failure');
			return original(callback, delayMs);
		};
		const { connection, factory } = connectionHarness({}, clock);
		connection.connect();
		factory.transports[0]?.open();
		factory.transports[0]?.close(1006, 'lost');
		expect(connection.getState().state).toBe('disconnected');
		expect(connection.getState().retryInMs).toBeUndefined();
	});

	it('validates options', () => {
		const clock = new FakeClock();
		const base = {
			url: 'ws://localhost',
			subprotocol: 'ocpp1.6' as const,
			transportFactory: new FakeTransportFactory().factory,
			scheduler: new Scheduler(clock),
			events: new EventEmitter(() => 0),
		};
		expect(() => new Connection({ ...base, url: '' })).toThrow(SimulatorError);
		expect(() => new Connection({ ...base, reconnect: { maxAttempts: 0 } })).toThrow(
			SimulatorError,
		);
	});
});

describe('OfflineQueue', () => {
	function queue(maxEntries = 10) {
		const clock = new FakeClock();
		return { clock, queue: new OfflineQueue({ maxEntries, now: () => clock.now() }) };
	}

	it('canonicalizes entries and does not follow caller mutation', () => {
		const { queue: q } = queue();
		const payload = { idTag: 'A' };
		q.enqueue('Authorize', payload, 'id-1');
		payload.idTag = 'B';
		expect(q.get()[0]?.payload).toEqual({ idTag: 'A' });
		expect(q.get()[0]?.text).toBe('[2,"id-1","Authorize",{"idTag":"A"}]');
	});

	it('flushes FIFO and stops at a failed head', async () => {
		const { queue: q } = queue();
		q.enqueue('Authorize', { idTag: 'A' }, 'id-1');
		q.enqueue('StatusNotification', { status: 'Available' }, 'id-2');
		const sent: string[] = [];
		const result = await q.flush(async (text) => {
			await Promise.resolve();
			sent.push(text);
			if (text.includes('Available')) throw new Error('down');
		});
		expect(result).toMatchObject({ sent: 1, remaining: 1, stoppedBy: 'send-failed' });
		expect(q.get()[0]?.messageId).toBe('id-2');
	});

	it('drops the oldest entry on overflow', () => {
		const { queue: q } = queue(2);
		q.enqueue('Authorize', { idTag: 'A' }, 'id-1');
		q.enqueue('Authorize', { idTag: 'B' }, 'id-2');
		const dropped = q.enqueue('Authorize', { idTag: 'C' }, 'id-3');
		expect(dropped?.messageId).toBe('id-1');
		expect(q.get().map((entry) => entry.messageId)).toEqual(['id-2', 'id-3']);
	});

	it('does not queue BootNotification or Heartbeat', () => {
		const { queue: q } = queue();
		expect(() => q.enqueue('BootNotification', {}, 'id-1')).toThrow(SimulatorError);
		expect(() => q.enqueue('Heartbeat', {}, 'id-2')).toThrow(SimulatorError);
	});

	it('stops when the queue changes during a flush', async () => {
		const { queue: q } = queue();
		q.enqueue('Authorize', { idTag: 'A' }, 'id-1');
		let release: (() => void) | undefined;
		const gate = new Promise<void>((resolve) => {
			release = resolve;
		});
		const flushing = q.flush(async () => {
			await gate;
		});
		q.clear();
		release?.();
		await expect(flushing).resolves.toMatchObject({ sent: 0, remaining: 0, stoppedBy: 'changed' });
	});

	it('round-trips a snapshot and rejects hostile snapshots', () => {
		const { queue: q } = queue();
		q.enqueue('Authorize', { idTag: 'A' }, 'id-1');
		const snapshot = q.snapshot();
		q.clear();
		q.restore(JSON.parse(JSON.stringify(snapshot)) as unknown);
		expect(q.get()[0]?.messageId).toBe('id-1');
		expect(() => q.restore({ version: 2, entries: [] })).toThrow('snapshot is invalid');
		expect(() => q.restore({ version: 1, entries: ['[3,"id",{}]'] })).toThrow('non-CALL');
		expect(() =>
			q.restore({
				version: 1,
				entries: ['[2,"same","Authorize",{}]', '[2,"same","Authorize",{}]'],
			}),
		).toThrow('duplicate');
	});

	it('accepts a snapshot only up to maxEntries', () => {
		const { queue: q } = queue(1);
		expect(() =>
			q.restore({
				version: 1,
				entries: ['[2,"id-1","Authorize",{}]', '[2,"id-2","Authorize",{}]'],
			}),
		).toThrow('too large');
	});

	it('does not resend a head when enqueue happens during its send', async () => {
		const { queue: q } = queue();
		q.enqueue('Authorize', { idTag: 'A' }, 'id-1');
		q.enqueue('Authorize', { idTag: 'B' }, 'id-2');
		let first = true;
		const sent: string[] = [];
		const result = await q.flush(async (text) => {
			await Promise.resolve();
			if (first) {
				first = false;
				sent.push(text);
				q.enqueue('Authorize', { idTag: 'C' }, 'id-3');
				return;
			}
			sent.push(text);
		});
		expect(result).toMatchObject({ sent: 1, remaining: 2, stoppedBy: 'changed' });
		await q.flush(async (text) => {
			await Promise.resolve();
			sent.push(text);
		});
		expect(sent.filter((text) => text.includes('"A"')).length).toBe(1);
	});

	it('rejects duplicate ids at enqueue', () => {
		const { queue: q } = queue();
		q.enqueue('Authorize', { idTag: 'A' }, 'same');
		expect(() => q.enqueue('Authorize', { idTag: 'B' }, 'same')).toThrow('already has');
	});

	it('removes only the sent head and preserves the rest', async () => {
		const { queue: q } = queue();
		q.enqueue('Authorize', { idTag: 'A' }, 'id-1');
		q.enqueue('Authorize', { idTag: 'B' }, 'id-2');
		const result = await q.flush(() => Promise.resolve());
		expect(result).toMatchObject({ sent: 2, remaining: 0 });
		expect(q.size).toBe(0);
	});
});
