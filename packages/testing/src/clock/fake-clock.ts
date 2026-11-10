// SPDX-License-Identifier: Apache-2.0
// SPDX-FileCopyrightText: 2026 Rodolfo Carrillo

import type { Clock, TimerHandle } from '@ocpptools/core';

import { FakeClockError } from '../errors.js';

const MAX_CALLBACKS = 10_000;

export interface FakeClockOptions {
	/** Initial time in milliseconds. Defaults to 0. */
	readonly now?: number;
}

export interface FakeClock extends Clock {
	/** Advances time and runs every timer due at or before the new time. */
	advance(ms: number): void;
	/** Runs every pending timer, with a limit of 10 000 callbacks. */
	runAll(): void;
	/** Number of pending timers. */
	readonly pendingTimers: number;
}

interface Timer {
	readonly at: number;
	readonly order: number;
	readonly callback: () => void;
}

interface HeapEntry {
	readonly id: number;
	readonly at: number;
	readonly order: number;
}

function validTime(value: unknown, label: string): number {
	if (typeof value !== 'number' || !Number.isFinite(value) || value < 0) {
		throw new FakeClockError(
			'invalid-time',
			`${label} must be a finite number greater than or equal to 0`,
		);
	}
	return value;
}

function before(left: HeapEntry, right: HeapEntry): boolean {
	return left.at < right.at || (left.at === right.at && left.order < right.order);
}

class FakeClockImpl implements FakeClock {
	private time: number;
	private nextId = 1;
	private nextOrder = 0;
	private readonly timers = new Map<number, Timer>();
	private readonly heap: HeapEntry[] = [];

	constructor(options: FakeClockOptions) {
		this.time = validTime(options.now ?? 0, 'now');
	}

	now(): number {
		return this.time;
	}

	setTimeout(callback: () => void, delayMs: number): TimerHandle {
		const delay = validTime(delayMs, 'delayMs');
		const at = this.time + Math.ceil(delay);
		if (!Number.isFinite(at)) {
			throw new FakeClockError('invalid-time', 'The timer deadline is not a finite number');
		}
		const id = this.nextId;
		this.nextId += 1;
		const timer = { at, order: this.nextOrder, callback };
		this.nextOrder += 1;
		this.timers.set(id, timer);
		this.push({ id, at, order: timer.order });
		return id;
	}

	clearTimeout(handle: TimerHandle): void {
		if (typeof handle === 'number') this.timers.delete(handle);
	}

	advance(ms: number): void {
		const amount = validTime(ms, 'ms');
		const target = this.time + Math.ceil(amount);
		if (!Number.isFinite(target)) {
			throw new FakeClockError('invalid-time', 'The target time is not a finite number');
		}
		let count = 0;
		for (;;) {
			const next = this.peekTimer(target);
			if (next === undefined) break;
			if (count >= MAX_CALLBACKS) {
				throw new FakeClockError('not-making-progress', 'The fake clock is not making progress');
			}
			this.takeTimer(next);
			this.time = next.timer.at;
			next.timer.callback();
			count += 1;
		}
		this.time = target;
	}

	runAll(): void {
		let count = 0;
		for (;;) {
			const next = this.peekTimer(Number.POSITIVE_INFINITY);
			if (next === undefined) break;
			if (count >= MAX_CALLBACKS) {
				throw new FakeClockError('not-making-progress', 'The fake clock is not making progress');
			}
			this.takeTimer(next);
			this.time = next.timer.at;
			next.timer.callback();
			count += 1;
		}
	}

	get pendingTimers(): number {
		return this.timers.size;
	}

	private peekTimer(target: number): { readonly id: number; readonly timer: Timer } | undefined {
		for (;;) {
			const top = this.heap[0];
			if (top === undefined) return undefined;
			const timer = this.timers.get(top.id);
			if (timer === undefined || timer.at !== top.at || timer.order !== top.order) {
				this.pop();
				continue;
			}
			if (top.at > target) return undefined;
			return { id: top.id, timer };
		}
	}

	private takeTimer(next: { readonly id: number }): void {
		this.pop();
		this.timers.delete(next.id);
	}

	private push(entry: HeapEntry): void {
		this.heap.push(entry);
		let index = this.heap.length - 1;
		while (index > 0) {
			const parent = Math.floor((index - 1) / 2);
			const parentEntry = this.heap[parent];
			if (parentEntry === undefined || !before(entry, parentEntry)) break;
			this.heap[index] = parentEntry;
			index = parent;
		}
		this.heap[index] = entry;
	}

	private pop(): HeapEntry | undefined {
		const first = this.heap[0];
		const last = this.heap.pop();
		if (first === undefined || last === undefined || this.heap.length === 0) return first;
		let index = 0;
		for (;;) {
			const left = index * 2 + 1;
			const right = left + 1;
			const leftEntry = this.heap[left];
			const rightEntry = this.heap[right];
			const smallest =
				leftEntry === undefined
					? undefined
					: rightEntry === undefined || before(leftEntry, rightEntry)
						? leftEntry
						: rightEntry;
			if (smallest === undefined || !before(smallest, last)) break;
			this.heap[index] = smallest;
			index = smallest === leftEntry ? left : right;
		}
		this.heap[index] = last;
		return first;
	}
}

/** Creates a deterministic clock that does not use ambient time. */
export function createFakeClock(options: FakeClockOptions = {}): FakeClock {
	return new FakeClockImpl(options);
}

/** Lets pending promise continuations run without real timers. */
export async function flushMicrotasks(rounds = 8): Promise<void> {
	if (!Number.isSafeInteger(rounds) || rounds <= 0) {
		throw new FakeClockError('invalid-rounds', 'rounds must be a positive safe integer');
	}
	for (let index = 0; index < rounds; index += 1) {
		await Promise.resolve();
	}
}
