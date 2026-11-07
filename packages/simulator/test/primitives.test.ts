// SPDX-License-Identifier: Apache-2.0
// SPDX-FileCopyrightText: 2026 Rodolfo Carrillo

import { describe, expect, it } from 'vitest';

import { SimulatorError, errorSnapshot } from '../src/index.js';
import { Scheduler } from '../src/clock.js';
import { EventEmitter } from '../src/events.js';
import { History } from '../src/log.js';
import { defaultRandom } from '../src/random.js';
import { FakeClock, flushMicrotasks } from './helpers/fake-clock.js';

describe('Scheduler', () => {
	it('runs timers and clears fired handles', () => {
		const clock = new FakeClock();
		const scheduler = new Scheduler(clock);
		const fired: number[] = [];
		scheduler.setTimeout(() => {
			fired.push(clock.now());
		}, 100);
		clock.advance(99);
		expect(fired).toEqual([]);
		clock.advance(1);
		expect(fired).toEqual([100]);
		expect(scheduler.pendingTimers).toBe(0);
	});

	it('runs intervals with single-flight recursive timeouts', async () => {
		const clock = new FakeClock();
		const scheduler = new Scheduler(clock);
		const fired: number[] = [];
		const cancel = scheduler.setInterval(() => {
			fired.push(clock.now());
		}, 10);
		for (let index = 0; index < 3; index += 1) {
			clock.advance(10);
			await flushMicrotasks();
		}
		cancel();
		expect(fired).toEqual([10, 20, 30]);
		expect(scheduler.pendingTimers).toBe(0);
	});

	it('cancels sleeps and does not resurrect intervals after cancelAll', async () => {
		const clock = new FakeClock();
		const scheduler = new Scheduler(clock);
		const sleeping = scheduler.sleep(50);
		let ticks = 0;
		scheduler.setInterval(() => {
			ticks += 1;
		}, 10);
		clock.advance(10);
		await flushMicrotasks();
		scheduler.cancelAll();
		await expect(sleeping).resolves.toBe(false);
		clock.advance(100);
		await flushMicrotasks();
		expect(ticks).toBe(1);
		expect(scheduler.pendingTimers).toBe(0);
	});

	it('rejects invalid delays and refuses work after dispose', () => {
		const clock = new FakeClock();
		const scheduler = new Scheduler(clock);
		expect(() => scheduler.setTimeout(() => undefined, Number.NaN)).toThrow(SimulatorError);
		scheduler.dispose();
		expect(() => scheduler.setTimeout(() => undefined, 1)).toThrow('disposed');
		scheduler.dispose();
	});
});

describe('EventEmitter', () => {
	it('isolates sync and async listener failures', async () => {
		const clock = new FakeClock();
		const emitter = new EventEmitter(() => clock.now());
		const errors: string[] = [];
		emitter.on('notice', () => {
			throw new Error('sync boom');
		});
		emitter.on('notice', () => Promise.reject(new Error('async boom')));
		emitter.on('notice', (event) => {
			errors.push(event.message);
			return undefined;
		});
		emitter.on('error', (event) => {
			errors.push(event.error.message);
			return undefined;
		});
		emitter.emit({ type: 'notice', at: 1, level: 'info', message: 'ok' });
		await flushMicrotasks();
		expect(errors).toContain('ok');
		expect(errors).toEqual(expect.arrayContaining(['sync boom', 'async boom']));
	});

	it('supports unsubscribe and dispose', () => {
		const emitter = new EventEmitter(() => 0);
		const seen: string[] = [];
		const unsubscribe = emitter.on('notice', (event) => {
			seen.push(event.message);
		});
		emitter.emit({ type: 'notice', at: 0, level: 'info', message: 'one' });
		unsubscribe();
		emitter.emit({ type: 'notice', at: 0, level: 'info', message: 'two' });
		emitter.dispose();
		emitter.emit({ type: 'notice', at: 0, level: 'info', message: 'three' });
		expect(seen).toEqual(['one']);
	});
});

describe('History', () => {
	it('keeps the newest entries within the bound', () => {
		const history = new History(2);
		for (const message of ['one', 'two', 'three']) {
			history.add({ at: 0, direction: 'system', messageType: 'SYSTEM', action: message });
		}
		expect(history.get().map((entry) => entry.action)).toEqual(['three', 'two']);
		history.setMaxEntries(1);
		expect(history.get()).toHaveLength(1);
		history.clear();
		expect(history.get()).toEqual([]);
	});
});

describe('errors and random', () => {
	it('converts errors to serializable snapshots', () => {
		const snapshot = errorSnapshot(new SimulatorError('timeout', 'late'));
		expect(snapshot).toMatchObject({ name: 'SimulatorError', code: 'timeout', message: 'late' });
		expect(JSON.parse(JSON.stringify(snapshot))).toEqual(snapshot);
		expect(typeof defaultRandom()).toBe('number');
	});
});
