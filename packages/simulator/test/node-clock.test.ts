// SPDX-License-Identifier: Apache-2.0
// SPDX-FileCopyrightText: 2026 Rodolfo Carrillo

import { describe, expect, it } from 'vitest';

import { nodeClock } from '@ocpptools/simulator/node';

describe('node clock', () => {
	it('returns the current time in milliseconds', () => {
		const before = Date.now();
		const now = nodeClock.now();
		const after = Date.now();
		expect(now).toBeGreaterThanOrEqual(before);
		expect(now).toBeLessThanOrEqual(after);
	});

	it('runs a zero-delay timer', async () => {
		const fired = await new Promise<boolean>((resolve) => {
			nodeClock.setTimeout(() => resolve(true), 0);
		});
		expect(fired).toBe(true);
	});

	it('clears a pending timer', async () => {
		let fired = false;
		const handle = nodeClock.setTimeout(() => {
			fired = true;
		}, 0);
		nodeClock.clearTimeout(handle);
		nodeClock.clearTimeout(handle);
		await new Promise<void>((resolve) => {
			nodeClock.setTimeout(resolve, 10);
		});
		expect(fired).toBe(false);
	});
});
