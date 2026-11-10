// SPDX-License-Identifier: Apache-2.0
// SPDX-FileCopyrightText: 2026 Rodolfo Carrillo

import { describe, expect, it } from 'vitest';

import { createSimulator } from '@ocpptools/simulator';

import { createFakeClock } from '../src/clock/fake-clock.js';
import { createMockCsms } from '../src/csms/mock-csms.js';
import { createInMemoryTransportHub } from '../src/transport/in-memory.js';

const CURRENT_TIME = '2026-01-01T00:00:00Z';

describe('simulator integration over the in-memory transport', () => {
	it('runs a 1.6J boot, heartbeat and charging session', async () => {
		const clock = createFakeClock({ now: Date.UTC(2026, 0, 1) });
		const hub = createInMemoryTransportHub();
		let sequence = 0;
		const simulator = createSimulator({
			version: '1.6',
			url: 'ws://in-memory/CP-16',
			transport: hub.factory,
			clock,
			reconnect: { enabled: false },
			messageIds: () => `sim-${String((sequence += 1))}`,
			station: {
				id: 'CP-16',
				vendor: 'Acme',
				model: 'AC-7',
				firmwareVersion: '1.0.0',
				connectorCount: 1,
				defaultIdTag: 'TAG-16',
			},
		});
		simulator.connect();
		const pair = await hub.nextPair();
		const csms = createMockCsms({
			version: '1.6',
			transport: pair.server,
			handlers: {
				BootNotification: () => ({
					status: 'Accepted',
					currentTime: CURRENT_TIME,
					interval: 60,
				}),
				Heartbeat: () => ({ currentTime: CURRENT_TIME }),
				StatusNotification: () => ({}),
				Authorize: () => ({ idTagInfo: { status: 'Accepted' } }),
				StartTransaction: () => ({
					transactionId: 1,
					idTagInfo: { status: 'Accepted' },
				}),
				StopTransaction: () => ({ idTagInfo: { status: 'Accepted' } }),
				MeterValues: () => ({}),
			},
		});
		try {
			pair.link.open();
			await hub.flush();

			expect(simulator.isReady).toBe(true);
			const started = await simulator.startChargingSession(1, 'TAG-16');
			expect(started.ok).toBe(true);
			await hub.flush();

			clock.advance(60_000);
			await hub.flush();

			const actions = csms.calls.map((call) => call[2]);
			expect(actions).toContain('BootNotification');
			expect(actions).toContain('Authorize');
			expect(actions).toContain('StartTransaction');
			expect(actions).toContain('Heartbeat');

			await simulator.stopTransaction(1);
			await hub.flush();
			expect(simulator.getState().completedTransactions).toHaveLength(1);
			expect(csms.errors).toEqual([]);
			expect(csms.pending).toEqual([]);
			simulator.dispose();
			await hub.flush();
			expect(hub.requests).toHaveLength(1);
			expect(clock.pendingTimers).toBe(0);
			expect(pair.client.state).toBe('closed');
			expect(pair.server.state).toBe('closed');
		} finally {
			simulator.dispose();
			hub.closeAll();
		}
	});

	it('runs a 2.0.1 boot, heartbeat and charging session', async () => {
		const clock = createFakeClock({ now: Date.UTC(2026, 0, 1) });
		const hub = createInMemoryTransportHub();
		let sequence = 0;
		const simulator = createSimulator({
			version: '2.0.1',
			url: 'ws://in-memory/CP-201',
			transport: hub.factory,
			clock,
			reconnect: { enabled: false },
			messageIds: () => `sim-${String((sequence += 1))}`,
			station: {
				id: 'CP-201',
				vendorName: 'Acme',
				model: 'AC-22',
				firmwareVersion: '2.0.0',
				evseCount: 1,
				defaultIdToken: 'TAG-201',
			},
		});
		simulator.connect();
		const pair = await hub.nextPair();
		const csms = createMockCsms({
			version: '2.0.1',
			transport: pair.server,
			handlers: {
				BootNotification: () => ({
					status: 'Accepted',
					currentTime: CURRENT_TIME,
					interval: 60,
				}),
				Heartbeat: () => ({ currentTime: CURRENT_TIME }),
				StatusNotification: () => ({}),
				Authorize: () => ({ idTokenInfo: { status: 'Accepted' } }),
				TransactionEvent: () => ({}),
			},
		});
		try {
			pair.link.open();
			await hub.flush();

			expect(simulator.isReady).toBe(true);
			const started = await simulator.startChargingSession(1, 'TAG-201');
			expect(started.ok).toBe(true);
			await hub.flush();

			clock.advance(60_000);
			await hub.flush();

			const actions = csms.calls.map((call) => call[2]);
			expect(actions).toContain('BootNotification');
			expect(actions).toContain('Authorize');
			expect(actions).toContain('TransactionEvent');
			expect(actions).toContain('Heartbeat');

			await simulator.stopTransaction(1);
			await hub.flush();
			expect(simulator.getState().completedTransactions).toHaveLength(1);
			expect(csms.errors).toEqual([]);
			expect(csms.pending).toEqual([]);
			simulator.dispose();
			await hub.flush();
			expect(hub.requests).toHaveLength(1);
			expect(clock.pendingTimers).toBe(0);
			expect(pair.client.state).toBe('closed');
			expect(pair.server.state).toBe('closed');
		} finally {
			simulator.dispose();
			hub.closeAll();
		}
	});
});
