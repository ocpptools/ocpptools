// SPDX-License-Identifier: Apache-2.0
// SPDX-FileCopyrightText: 2026 Rodolfo Carrillo

/**
 * Identifies a pending timer. It is a number in browsers and an object in
 * Node, so treat it as opaque and only pass it back to {@link Clock.clearTimeout}.
 */
export type TimerHandle = number | object;

/**
 * Time and timers, injected so code that depends on them runs the same in a
 * browser, in Node, and under a fake clock in tests.
 */
export interface Clock {
	/** The current time in milliseconds since the Unix epoch. */
	now(): number;
	/** Calls `callback` once after `delayMs` milliseconds. */
	setTimeout(callback: () => void, delayMs: number): TimerHandle;
	/** Cancels a timer. Does nothing when it already fired or was cancelled. */
	clearTimeout(handle: TimerHandle): void;
}
