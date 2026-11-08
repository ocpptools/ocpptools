// SPDX-License-Identifier: Apache-2.0
// SPDX-FileCopyrightText: 2026 Rodolfo Carrillo

import { describe, expect, it } from 'vitest';

import { Metrics } from '../src/metrics.js';

describe('Metrics', () => {
	it('aggregates RTT per action', () => {
		const metrics = new Metrics();
		metrics.recordRtt('Authorize', 10);
		metrics.recordRtt('Authorize', 20);
		const snapshot = metrics.snapshot(0);
		expect(snapshot.rttByAction['Authorize']).toMatchObject({
			count: 2,
			totalMs: 30,
			lastMs: 20,
			maxMs: 20,
			averageMs: 15,
		});
	});

	it('prunes errors outside the minute window', () => {
		const metrics = new Metrics();
		metrics.recordError(1_000);
		expect(metrics.snapshot(2_000).errorCountLastMinute).toBe(1);
		expect(metrics.snapshot(70_000).errorCountLastMinute).toBe(0);
	});

	it('records heartbeat drift and resets the baseline', () => {
		const metrics = new Metrics();
		metrics.recordHeartbeat(1000, 0);
		metrics.recordHeartbeat(1000, 1500);
		expect(metrics.snapshot(2000).heartbeat).toMatchObject({
			samples: 1,
			lastDriftMs: 500,
			averageDriftMs: 500,
		});
		metrics.resetHeartbeat();
		metrics.recordHeartbeat(1000, 3000);
		expect(metrics.snapshot(4000).heartbeat.samples).toBe(1);
	});

	it('resets all metrics', () => {
		const metrics = new Metrics();
		metrics.recordRtt('A', 1);
		metrics.recordError(1);
		metrics.recordHeartbeat(1, 1);
		metrics.recordHeartbeat(1, 3);
		metrics.reset();
		expect(metrics.snapshot(10)).toEqual({
			errorCountLastMinute: 0,
			rttByAction: {},
			heartbeat: { samples: 0 },
		});
	});
});
