// SPDX-License-Identifier: Apache-2.0
// SPDX-FileCopyrightText: 2026 Rodolfo Carrillo

import { describe, expect, it } from 'vitest';

import { createFakeClock, flushMicrotasks } from '../src/clock/fake-clock.js';
import { FakeClockError } from '../src/errors.js';

describe('fake clock', () => {
	it('starts at the configured time and advances', () => {
		const clock = createFakeClock({ now: 100 });
		expect(clock.now()).toBe(100);
		clock.advance(25);
		expect(clock.now()).toBe(125);
		expect(clock.pendingTimers).toBe(0);
	});

	it('runs timers in order and same-due timers by insertion order', () => {
		const clock = createFakeClock();
		const order: string[] = [];
		clock.setTimeout(() => order.push('late'), 10);
		clock.setTimeout(() => order.push('first'), 5);
		clock.setTimeout(() => order.push('second'), 5);
		clock.advance(10);
		expect(order).toEqual(['first', 'second', 'late']);
		expect(clock.now()).toBe(10);
	});

	it('runs timers scheduled during callbacks when they are due before the target', () => {
		const clock = createFakeClock();
		const order: string[] = [];
		clock.setTimeout(() => {
			order.push('outer');
			clock.setTimeout(() => order.push('inner'), 5);
		}, 5);
		clock.advance(15);
		expect(order).toEqual(['outer', 'inner']);
		expect(clock.now()).toBe(15);
	});

	it('clears timers and clears a same-due successor', () => {
		const clock = createFakeClock();
		const order: string[] = [];
		const first = clock.setTimeout(() => {
			order.push('first');
		}, 5);
		clock.setTimeout(() => {
			order.push('second');
		}, 5);
		clock.clearTimeout(first);
		clock.advance(5);
		expect(order).toEqual(['second']);
		expect(clock.pendingTimers).toBe(0);
	});

	it('runs zero-delay timers and advances without timers', () => {
		const clock = createFakeClock();
		let ran = false;
		clock.setTimeout(() => {
			ran = true;
		}, 0);
		clock.advance(0);
		expect(ran).toBe(true);
		clock.advance(10);
		expect(clock.now()).toBe(10);
	});

	it('runs all timers and leaves now at the last timer', () => {
		const clock = createFakeClock({ now: 3 });
		clock.setTimeout(() => undefined, 4);
		clock.setTimeout(() => undefined, 9);
		clock.runAll();
		expect(clock.now()).toBe(12);
		expect(clock.pendingTimers).toBe(0);
		clock.runAll();
		expect(clock.now()).toBe(12);
	});

	it('allows 10 000 callbacks and rejects the 10 001st', () => {
		const allowed = createFakeClock();
		for (let index = 0; index < 10_000; index += 1) {
			allowed.setTimeout(() => undefined, 0);
		}
		expect(() => allowed.advance(0)).not.toThrow();
		expect(allowed.pendingTimers).toBe(0);

		const rejected = createFakeClock();
		for (let index = 0; index < 10_001; index += 1) {
			rejected.setTimeout(() => undefined, 0);
		}
		expect(() => rejected.advance(0)).toThrow(FakeClockError);
		expect(rejected.pendingTimers).toBe(1);

		const runAllRejected = createFakeClock();
		for (let index = 0; index < 10_001; index += 1) {
			runAllRejected.setTimeout(() => undefined, 0);
		}
		expect(() => runAllRejected.runAll()).toThrow(FakeClockError);
		expect(runAllRejected.pendingTimers).toBe(1);
	});

	it('keeps now at the throwing timer and leaves the target unapplied', () => {
		const clock = createFakeClock();
		clock.setTimeout(() => {
			throw new Error('timer failed');
		}, 10);
		clock.setTimeout(() => undefined, 20);
		expect(() => clock.advance(30)).toThrow('timer failed');
		expect(clock.now()).toBe(10);
		expect(clock.pendingTimers).toBe(1);
	});

	it('rounds fractional delays and advances up', () => {
		const clock = createFakeClock();
		let at = -1;
		clock.setTimeout(() => {
			at = clock.now();
		}, 1.2);
		clock.advance(1.2);
		expect(at).toBe(2);
		expect(clock.now()).toBe(2);
	});

	it('rejects invalid time values', () => {
		expect(() => createFakeClock({ now: -1 })).toThrow(FakeClockError);
		expect(() => createFakeClock({ now: Number.NaN })).toThrow(FakeClockError);
		const clock = createFakeClock();
		expect(() => clock.advance(-1)).toThrow(FakeClockError);
		expect(() => clock.advance(Number.POSITIVE_INFINITY)).toThrow(FakeClockError);
		expect(() => clock.setTimeout(() => undefined, -1)).toThrow(FakeClockError);
		expect(() => clock.setTimeout(() => undefined, Number.NaN)).toThrow(FakeClockError);
	});

	it('flushes microtasks and rejects invalid round counts', async () => {
		let ran = false;
		void Promise.resolve().then(() => {
			ran = true;
		});
		await flushMicrotasks();
		expect(ran).toBe(true);
		await expect(flushMicrotasks(0)).rejects.toMatchObject({ code: 'invalid-rounds' });
		await expect(flushMicrotasks(1.5)).rejects.toMatchObject({ code: 'invalid-rounds' });
	});
});
