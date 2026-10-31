// SPDX-License-Identifier: Apache-2.0
// SPDX-FileCopyrightText: 2026 Rodolfo Carrillo

import { describe, expect, expectTypeOf, it } from 'vitest';
import {
	OCPP_SUBPROTOCOLS,
	parseFrame,
	serializeFrame,
	type Clock,
	type Storage,
	type TimerHandle,
	type Transport,
	type TransportCloseEvent,
	type TransportConnectOptions,
	type TransportFactory,
	type TransportState,
	type Unsubscribe,
} from '../src/index.js';

// These fakes show that the interfaces are small enough to implement and that
// they compose with the frame functions. They are the pattern the simulator
// and testing packages will follow.

class FakeTransport implements Transport {
	state: TransportState = 'connecting';
	readonly sent: string[] = [];
	private readonly openListeners = new Set<() => void>();
	private readonly messageListeners = new Set<(data: string) => void>();
	private readonly errorListeners = new Set<(error: unknown) => void>();
	private readonly closeListeners = new Set<(event: TransportCloseEvent) => void>();

	send(data: string): void {
		if (this.state !== 'open') {
			throw new Error('Transport is not open');
		}
		this.sent.push(data);
	}

	close(code = 1000, reason = ''): void {
		if (this.state === 'closing' || this.state === 'closed') return;
		this.state = 'closed';
		for (const listener of this.closeListeners) listener({ code, reason, wasClean: true });
	}

	onOpen(listener: () => void): Unsubscribe {
		return add(this.openListeners, listener);
	}

	onMessage(listener: (data: string) => void): Unsubscribe {
		return add(this.messageListeners, listener);
	}

	onError(listener: (error: unknown) => void): Unsubscribe {
		return add(this.errorListeners, listener);
	}

	onClose(listener: (event: TransportCloseEvent) => void): Unsubscribe {
		return add(this.closeListeners, listener);
	}

	// Test controls, not part of the interface.
	open(): void {
		this.state = 'open';
		for (const listener of this.openListeners) listener();
	}

	receive(data: string): void {
		for (const listener of this.messageListeners) listener(data);
	}

	fail(error: unknown): void {
		for (const listener of this.errorListeners) listener(error);
	}
}

function add<T>(listeners: Set<T>, listener: T): Unsubscribe {
	listeners.add(listener);
	return () => {
		listeners.delete(listener);
	};
}

class FakeClock implements Clock {
	private time = 0;
	private nextId = 1;
	private readonly timers = new Map<number, { at: number; callback: () => void }>();

	now(): number {
		return this.time;
	}

	setTimeout(callback: () => void, delayMs: number): TimerHandle {
		const id = this.nextId++;
		this.timers.set(id, { at: this.time + delayMs, callback });
		return id;
	}

	clearTimeout(handle: TimerHandle): void {
		this.timers.delete(handle as number);
	}

	advance(ms: number): void {
		this.time += ms;
		for (const [id, timer] of [...this.timers]) {
			if (timer.at <= this.time) {
				this.timers.delete(id);
				timer.callback();
			}
		}
	}
}

class MemoryStorage implements Storage {
	private readonly values = new Map<string, string>();

	get(key: string): Promise<string | undefined> {
		return Promise.resolve(this.values.get(key));
	}

	set(key: string, value: string): Promise<void> {
		this.values.set(key, value);
		return Promise.resolve();
	}

	delete(key: string): Promise<void> {
		this.values.delete(key);
		return Promise.resolve();
	}
}

describe('Transport', () => {
	it('moves frames through serializeFrame and parseFrame', () => {
		const transport = new FakeTransport();
		const received: unknown[] = [];
		transport.onMessage((data) => {
			const parsed = parseFrame(data);
			if (parsed.ok) received.push(parsed.value);
		});

		transport.open();
		const text = serializeFrame([2, '1', 'Heartbeat', {}]);
		if (text.ok) transport.send(text.value);
		transport.receive('[3,"1",{"currentTime":"2026-01-01T00:00:00Z"}]');

		expect(transport.sent).toEqual(['[2,"1","Heartbeat",{}]']);
		expect(received).toEqual([[3, '1', { currentTime: '2026-01-01T00:00:00Z' }]]);
	});

	it('refuses to send before it is open', () => {
		expect(() => {
			new FakeTransport().send('[]');
		}).toThrow('not open');
	});

	it('stops calling a listener after it is unsubscribed', () => {
		const transport = new FakeTransport();
		const calls: string[] = [];
		const unsubscribe = transport.onMessage((data) => calls.push(data));
		transport.receive('a');
		unsubscribe();
		unsubscribe();
		transport.receive('b');
		expect(calls).toEqual(['a']);
	});

	it('reports opening, errors, and closing through listeners', () => {
		const transport = new FakeTransport();
		const events: string[] = [];
		transport.onOpen(() => events.push('open'));
		transport.onError(() => events.push('error'));
		transport.onClose((event) => events.push(`close ${String(event.code)}`));
		transport.open();
		transport.fail(new Error('network down'));
		transport.close(1006);
		transport.close(1000);
		expect(events).toEqual(['open', 'error', 'close 1006']);
	});

	it('is created by a TransportFactory with the subprotocol to request', () => {
		const requests: TransportConnectOptions[] = [];
		const factory: TransportFactory = (options) => {
			requests.push(options);
			return new FakeTransport();
		};
		const transport = factory({
			url: 'ws://localhost/CP001',
			subprotocol: OCPP_SUBPROTOCOLS['2.0.1'],
		});
		expect(transport.state).toBe('connecting');
		expect(requests).toEqual([{ url: 'ws://localhost/CP001', subprotocol: 'ocpp2.0.1' }]);
	});

	it('has the documented types', () => {
		expectTypeOf<TransportState>().toEqualTypeOf<'connecting' | 'open' | 'closing' | 'closed'>();
		expectTypeOf<Transport['send']>().toEqualTypeOf<(data: string) => void>();
		expectTypeOf<TransportFactory>().returns.toEqualTypeOf<Transport>();
		expectTypeOf<TransportConnectOptions['subprotocol']>().toEqualTypeOf<'ocpp1.6' | 'ocpp2.0.1'>();
	});
});

describe('Clock', () => {
	it('runs a timer when its time comes and not before', () => {
		const clock = new FakeClock();
		const fired: number[] = [];
		clock.setTimeout(() => fired.push(clock.now()), 100);
		clock.advance(99);
		expect(fired).toEqual([]);
		clock.advance(1);
		expect(fired).toEqual([100]);
	});

	it('does not run a cancelled timer', () => {
		const clock = new FakeClock();
		let fired = false;
		const handle = clock.setTimeout(() => (fired = true), 10);
		clock.clearTimeout(handle);
		clock.clearTimeout(handle);
		clock.advance(10);
		expect(fired).toBe(false);
	});

	it('accepts a numeric handle (browsers) and an object handle (Node)', () => {
		expectTypeOf<number>().toExtend<TimerHandle>();
		expectTypeOf<{ ref(): void }>().toExtend<TimerHandle>();
	});
});

describe('Storage', () => {
	it('stores, replaces, and removes text values', async () => {
		const storage = new MemoryStorage();
		expect(await storage.get('queue')).toBeUndefined();
		await storage.set('queue', '[1]');
		await storage.set('queue', '[1,2]');
		expect(await storage.get('queue')).toBe('[1,2]');
		await storage.delete('queue');
		await storage.delete('queue');
		expect(await storage.get('queue')).toBeUndefined();
	});

	it('is asynchronous', () => {
		expectTypeOf<Storage['get']>().toEqualTypeOf<(key: string) => Promise<string | undefined>>();
	});
});
