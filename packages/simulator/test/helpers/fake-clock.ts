// SPDX-License-Identifier: Apache-2.0
// SPDX-FileCopyrightText: 2026 Rodolfo Carrillo

import type { Clock, TimerHandle } from '@ocpptools/core';

interface Timer {
	readonly at: number;
	readonly callback: () => void;
}

/** A deterministic clock that runs timers in chronological order. */
export class FakeClock implements Clock {
	private time = 0;
	private nextId = 1;
	private readonly timers = new Map<number, Timer>();

	now(): number {
		return this.time;
	}

	setTimeout(callback: () => void, delayMs: number): TimerHandle {
		const id = this.nextId++;
		this.timers.set(id, { at: this.time + Math.max(0, delayMs), callback });
		return id;
	}

	clearTimeout(handle: TimerHandle): void {
		this.timers.delete(handle as number);
	}

	advance(ms: number): void {
		const target = this.time + Math.max(0, ms);
		let iterations = 0;
		for (;;) {
			let nextId: number | undefined;
			let next: Timer | undefined;
			for (const [id, timer] of this.timers) {
				if (timer.at <= target && (next === undefined || timer.at < next.at)) {
					nextId = id;
					next = timer;
				}
			}
			if (nextId === undefined || next === undefined) {
				break;
			}
			this.timers.delete(nextId);
			this.time = next.at;
			next.callback();
			iterations += 1;
			if (iterations > 10_000) {
				throw new Error('The fake clock is not making progress');
			}
		}
		this.time = target;
	}

	get pendingTimers(): number {
		return this.timers.size;
	}
}

/** Lets pending promise continuations run without using a real timer. */
export async function flushMicrotasks(rounds = 8): Promise<void> {
	for (let index = 0; index < rounds; index += 1) {
		await Promise.resolve();
	}
}
