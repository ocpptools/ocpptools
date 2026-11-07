// SPDX-License-Identifier: Apache-2.0
// SPDX-FileCopyrightText: 2026 Rodolfo Carrillo

import type { Clock, TimerHandle } from '@ocpptools/core';

import { SimulatorError } from './errors.js';

type TimerCallback = () => void | Promise<void>;

/**
 * A scheduler built on the injected Clock. It never uses the global timers and
 * it owns every handle it creates, so disposing a simulator cannot leave a
 * timer behind.
 */
export class Scheduler {
	private readonly clock: Clock;
	private readonly onError: ((error: unknown) => void) | undefined;
	private readonly timers = new Map<number, TimerHandle>();
	private readonly sleeps = new Map<number, (completed: boolean) => void>();
	private nextId = 1;
	private generation = 0;
	private disposed = false;

	constructor(clock: Clock, options: { onError?: (error: unknown) => void } = {}) {
		this.clock = clock;
		this.onError = options.onError;
	}

	now(): number {
		return this.clock.now();
	}

	setTimeout(callback: TimerCallback, delayMs: number): () => void {
		this.assertActive();
		const delay = validateDelay(delayMs);
		const id = this.nextId++;
		const timer = this.clock.setTimeout(() => {
			this.timers.delete(id);
			void this.run(callback);
		}, delay);
		this.timers.set(id, timer);
		return () => {
			const handle = this.timers.get(id);
			if (handle !== undefined) {
				this.timers.delete(id);
				this.clock.clearTimeout(handle);
			}
		};
	}

	setInterval(callback: TimerCallback, delayMs: number): () => void {
		this.assertActive();
		const delay = Math.max(1, validateDelay(delayMs));
		const generation = this.generation;
		let cancelled = false;
		let cancelTimer: (() => void) | undefined;

		const tick = (): void => {
			if (cancelled || this.disposed || generation !== this.generation) {
				return;
			}
			void (async () => {
				try {
					await callback();
				} catch (error) {
					this.report(error);
				} finally {
					if (!cancelled && !this.disposed && generation === this.generation) {
						cancelTimer = this.setTimeout(tick, delay);
					}
				}
			})();
		};

		cancelTimer = this.setTimeout(tick, delay);
		return () => {
			cancelled = true;
			cancelTimer?.();
		};
	}

	sleep(delayMs: number): Promise<boolean> {
		if (this.disposed) {
			return Promise.resolve(false);
		}
		const delay = validateDelay(delayMs);
		return new Promise<boolean>((resolve) => {
			const id = this.nextId++;
			const timer = this.clock.setTimeout(() => {
				this.timers.delete(id);
				this.sleeps.delete(id);
				resolve(true);
			}, delay);
			this.timers.set(id, timer);
			this.sleeps.set(id, resolve);
		});
	}

	cancelAll(): void {
		this.generation += 1;
		for (const handle of this.timers.values()) {
			this.clock.clearTimeout(handle);
		}
		this.timers.clear();
		for (const resolve of this.sleeps.values()) {
			resolve(false);
		}
		this.sleeps.clear();
	}

	dispose(): void {
		if (this.disposed) {
			return;
		}
		this.disposed = true;
		this.cancelAll();
	}

	get pendingTimers(): number {
		return this.timers.size;
	}

	private assertActive(): void {
		if (this.disposed) {
			throw new SimulatorError('disposed', 'The simulator scheduler is disposed');
		}
	}

	private async run(callback: TimerCallback): Promise<void> {
		try {
			await callback();
		} catch (error) {
			this.report(error);
		}
	}

	private report(error: unknown): void {
		try {
			this.onError?.(error);
		} catch {
			// An error sink must not turn a background timer into an unhandled rejection.
		}
	}
}

function validateDelay(delayMs: number): number {
	if (!Number.isFinite(delayMs) || delayMs < 0) {
		throw new SimulatorError('invalid-options', `Invalid timer delay: ${String(delayMs)}`);
	}
	return delayMs;
}
