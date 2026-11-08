// SPDX-License-Identifier: Apache-2.0
// SPDX-FileCopyrightText: 2026 Rodolfo Carrillo

import { describe, expect, it } from 'vitest';

import { createHarness201, framePayload, type Frame } from './helpers/simulator-201.js';
import { flushMicrotasks } from './helpers/fake-clock.js';

function transactionEvents(harness: ReturnType<typeof createHarness201>): Frame[] {
	return harness.calls('TransactionEvent').filter((frame) => {
		const payload = frame[3] as Record<string, unknown>;
		return payload['eventType'] === 'Updated';
	});
}

describe('Simulator201 engine', () => {
	it('boots with the 2.0.1 shape and reports every EVSE', async () => {
		const harness = createHarness201();
		await harness.ready();
		const simulator = harness.simulator;
		expect(simulator.isReady).toBe(true);
		expect(simulator.getState().boot.status).toBe('accepted');
		const boot = harness.calls('BootNotification')[0]![3] as Record<string, unknown>;
		expect(boot['reason']).toBe('PowerUp');
		expect(boot['chargingStation']).toMatchObject({
			model: 'AC-22',
			vendorName: 'Acme',
			firmwareVersion: '2.0.0',
		});
		const statuses = harness.calls('StatusNotification').map((frame) => frame[3]);
		expect(statuses).toHaveLength(2);
		expect(statuses).toEqual([
			expect.objectContaining({ evseId: 1, connectorId: 1, connectorStatus: 'Available' }),
			expect.objectContaining({ evseId: 2, connectorId: 1, connectorStatus: 'Available' }),
		]);
		expect(statuses.some((payload) => (payload as { evseId: number }).evseId === 0)).toBe(false);
	});

	it('stays not ready when boot is rejected', async () => {
		const harness = createHarness201({ bootStatus: 'Rejected' });
		await harness.ready();
		expect(harness.simulator.isReady).toBe(false);
		expect(harness.simulator.getState().boot.status).toBe('rejected');
		expect(harness.calls('StatusNotification')).toHaveLength(0);
	});

	it('retries a Pending boot and then becomes ready', async () => {
		const harness = createHarness201({
			bootStatus: (count) => (count === 1 ? 'Pending' : 'Accepted'),
			bootIntervalSeconds: 1,
		});
		await harness.ready();
		expect(harness.simulator.getState().boot.status).toBe('pending');
		expect(harness.simulator.isReady).toBe(false);
		harness.clock.advance(1000);
		await harness.ready();
		expect(harness.calls('BootNotification')).toHaveLength(2);
		expect(harness.simulator.isReady).toBe(true);
	});

	it('refuses a business call before boot is accepted', async () => {
		const harness = createHarness201({
			bootStatus: 'Pending',
			boot: { auto: true, required: true, retryOnPending: false },
		});
		await harness.ready();
		await expect(harness.simulator.sendCall('Heartbeat', {})).rejects.toMatchObject({
			code: 'not-ready',
		});
	});

	it('flushes queued calls before fresh status reconciliation', async () => {
		const harness = createHarness201({
			bootStatus: (count) => (count === 1 ? 'Pending' : 'Accepted'),
			bootIntervalSeconds: 1,
		});
		await harness.ready();
		await expect(
			harness.simulator.sendOrQueue('Authorize', { idToken: { idToken: 'A', type: 'ISO14443' } }),
		).resolves.toBe('queued');
		harness.clock.advance(1000);
		await harness.ready();
		const order = harness
			.sent()
			.filter(
				(frame) =>
					frame[0] === 2 && (frame[2] === 'Authorize' || frame[2] === 'StatusNotification'),
			)
			.map((frame) => frame[2]);
		expect(order[0]).toBe('Authorize');
		expect(order).toContain('StatusNotification');
	});

	it('runs the charging lifecycle with TransactionEvent updates', async () => {
		const harness = createHarness201();
		await harness.ready();
		const simulator = harness.simulator;
		const started = await simulator.startChargingSession(1, 'TAG');
		expect(started.ok).toBe(true);
		expect(typeof started.transactionId).toBe('string');
		const evse = simulator.getEvse(1)!;
		expect(evse.status).toBe('Occupied');
		expect(evse.transaction).not.toBeNull();
		const events = harness.calls('TransactionEvent').map((frame) => frame[3]);
		const first = events[0] as Record<string, unknown>;
		expect(first['eventType']).toBe('Started');
		expect(first['offline']).toBe(false);
		expect(first['idToken']).toEqual({ idToken: 'TAG', type: 'ISO14443' });
		expect(first['transactionInfo']).toMatchObject({
			transactionId: started.transactionId,
			chargingState: 'EVConnected',
		});
		const second = events[1] as Record<string, unknown>;
		expect(second['eventType']).toBe('Updated');
		expect(second['triggerReason']).toBe('ChargingStateChanged');
		expect(second['transactionInfo']).toMatchObject({ chargingState: 'Charging' });
		expect(Array.isArray(second['meterValue'])).toBe(true);

		const before = evse.meterWh;
		harness.clock.advance(30_000);
		await flushMicrotasks(40);
		expect(evse.meterWh).toBeGreaterThan(before);
		const periodic = transactionEvents(harness).filter((frame) => {
			const payload = frame[3] as Record<string, unknown>;
			return payload['triggerReason'] === 'MeterValuePeriodic';
		});
		expect(periodic.length).toBeGreaterThanOrEqual(1);
		const firstPeriodic = periodic[0]![3] as Record<string, unknown>;
		expect(firstPeriodic['offline']).toBe(false);
		expect(Array.isArray(firstPeriodic['meterValue'])).toBe(true);

		const stopped = await simulator.stopTransaction(1, 'Local');
		expect(stopped).toBe(true);
		expect(evse.status).toBe('Available');
		expect(evse.transaction).toBeNull();
		expect(evse.chargingPowerKw).toBe(7.4);
		expect(simulator.getState().completedTransactions).toHaveLength(1);
		const ended = harness
			.calls('TransactionEvent')
			.map((frame) => frame[3] as Record<string, unknown>)
			.filter((payload) => payload['eventType'] === 'Ended');
		expect(ended).toHaveLength(1);
		expect(ended[0]!['transactionInfo']).toMatchObject({
			stoppedReason: 'Local',
			chargingState: 'Idle',
		});
		expect(await simulator.stopTransaction(1, 'Local')).toBe(false);
	});

	it('rejects invalid charging sessions', async () => {
		const harness = createHarness201();
		await harness.ready();
		const simulator = harness.simulator;
		expect(await simulator.startChargingSession(99)).toMatchObject({
			ok: false,
			reason: 'invalid-evse',
		});
		expect((await simulator.startChargingSession(1, 'A')).ok).toBe(true);
		expect(await simulator.startChargingSession(1, 'A')).toMatchObject({
			ok: false,
			reason: 'occupied',
		});
		simulator.setEvseStatus(2, 'Unavailable');
		expect(await simulator.startChargingSession(2, 'A')).toMatchObject({
			ok: false,
			reason: 'not-available',
		});
		simulator.dispose();

		const rejected = createHarness201({ authorizeStatus: 'Invalid' });
		await rejected.ready();
		expect(await rejected.simulator.startChargingSession(1, 'A')).toMatchObject({
			ok: false,
			reason: 'authorize-rejected',
		});
		rejected.simulator.dispose();
	});

	it('accepts a Reserved EVSE', async () => {
		const harness = createHarness201();
		await harness.ready();
		harness.simulator.setEvseStatus(1, 'Reserved');
		expect((await harness.simulator.startChargingSession(1, 'A')).ok).toBe(true);
		expect(harness.simulator.getEvse(1)?.status).toBe('Occupied');
	});

	it('rolls back a start when a TransactionEvent cannot be sent', async () => {
		const harness = createHarness201();
		await harness.ready();
		const simulator = harness.simulator;
		const original = harness.transport.send.bind(harness.transport);
		harness.transport.send = (text: string): void => {
			const frame = JSON.parse(text) as unknown[];
			if (frame[0] === 2 && frame[2] === 'TransactionEvent') {
				throw new Error('wire down');
			}
			original(text);
		};
		await expect(simulator.startChargingSession(1, 'A')).rejects.toMatchObject({
			code: 'send-failed',
		});
		expect(simulator.getEvse(1)?.transaction).toBeNull();
		expect(simulator.getEvse(1)?.status).toBe('Available');
		const before = transactionEvents(harness).length;
		harness.clock.advance(120_000);
		await flushMicrotasks(40);
		expect(transactionEvents(harness).length).toBe(before);
	});

	it('rolls back a start when Started was delivered but Updated fails', async () => {
		const harness = createHarness201();
		await harness.ready();
		const simulator = harness.simulator;
		const original = harness.transport.send.bind(harness.transport);
		harness.transport.send = (text: string): void => {
			const frame = JSON.parse(text) as unknown[];
			if (
				frame[0] === 2 &&
				frame[2] === 'TransactionEvent' &&
				(frame[3] as Record<string, unknown>)['eventType'] === 'Updated'
			) {
				throw new Error('wire down');
			}
			original(text);
		};
		await expect(simulator.startChargingSession(1, 'A')).rejects.toMatchObject({
			code: 'send-failed',
		});
		expect(simulator.getEvse(1)?.transaction).toBeNull();
		expect(simulator.getEvse(1)?.status).toBe('Available');
		const ended = harness
			.calls('TransactionEvent')
			.map((frame) => frame[3] as Record<string, unknown>)
			.filter((payload) => payload['eventType'] === 'Ended');
		expect(ended.length).toBeGreaterThanOrEqual(1);
	});

	it('keeps the transaction when start rollback cannot send Ended', async () => {
		const harness = createHarness201();
		await harness.ready();
		const simulator = harness.simulator;
		const original = harness.transport.send.bind(harness.transport);
		harness.transport.send = (text: string): void => {
			const frame = JSON.parse(text) as unknown[];
			const payload = frame[3] as Record<string, unknown> | undefined;
			if (
				frame[0] === 2 &&
				frame[2] === 'TransactionEvent' &&
				(payload?.['eventType'] === 'Updated' || payload?.['eventType'] === 'Ended')
			) {
				throw new Error('wire down');
			}
			original(text);
		};
		await expect(simulator.startChargingSession(1, 'A')).rejects.toMatchObject({
			code: 'send-failed',
		});
		expect(simulator.getEvse(1)?.transaction).not.toBeNull();
		expect(simulator.getEvse(1)?.transaction?.seqNo).toBe(1);
		harness.transport.send = original;
		expect(await simulator.stopTransaction(1)).toBe(true);
		expect(simulator.getEvse(1)?.transaction).toBeNull();
	});

	it('does not fail a delivered stop when the final status fails', async () => {
		const harness = createHarness201();
		await harness.ready();
		const simulator = harness.simulator;
		await simulator.startChargingSession(1, 'A');
		const errors: string[] = [];
		simulator.on('error', (event) => {
			errors.push(event.error.message);
		});
		const notices: string[] = [];
		simulator.on('notice', (event) => {
			notices.push(event.message);
		});
		simulator.state.pendingResets = { station: false, evseIds: [1] };
		const original = harness.transport.send.bind(harness.transport);
		harness.transport.send = (text: string): void => {
			const frame = JSON.parse(text) as unknown[];
			if (frame[0] === 2 && frame[2] === 'StatusNotification') {
				throw new Error('status down');
			}
			original(text);
		};
		await expect(simulator.stopTransaction(1)).resolves.toBe(true);
		expect(simulator.getEvse(1)?.transaction).toBeNull();
		expect(simulator.getState().completedTransactions).toHaveLength(1);
		expect(errors).toContain('The transport rejected the frame');
		expect(simulator.state.pendingResets.evseIds).toHaveLength(0);
		expect(notices).toContain('Scheduled reset executed');
	});

	it('restores a transaction when the Ended event cannot be sent', async () => {
		const harness = createHarness201();
		await harness.ready();
		const simulator = harness.simulator;
		await simulator.startChargingSession(1, 'A');
		const original = harness.transport.send.bind(harness.transport);
		harness.transport.send = (text: string): void => {
			const frame = JSON.parse(text) as unknown[];
			if (
				frame[0] === 2 &&
				frame[2] === 'TransactionEvent' &&
				(frame[3] as Record<string, unknown>)['eventType'] === 'Ended'
			) {
				throw new Error('wire down');
			}
			original(text);
		};
		await expect(simulator.stopTransaction(1)).rejects.toMatchObject({
			code: 'send-failed',
		});
		expect(simulator.getEvse(1)?.transaction).not.toBeNull();
		expect(simulator.getEvse(1)?.transaction?.stopping).toBe(false);
		expect(simulator.getEvse(1)?.transaction?.seqNo).toBe(2);
		expect(simulator.getState().completedTransactions).toHaveLength(0);
		harness.transport.send = original;
		expect(await simulator.stopTransaction(1)).toBe(true);
		const retried = harness
			.calls('TransactionEvent')
			.map((frame) => frame[3] as Record<string, unknown>)
			.filter((payload) => payload['eventType'] === 'Ended')
			.at(-1);
		expect(retried?.['seqNo']).toBe(2);
		expect(simulator.getState().completedTransactions).toHaveLength(1);
	});

	it('sends standalone MeterValues and rejects an unknown EVSE', async () => {
		const harness = createHarness201();
		await harness.ready();
		await harness.simulator.sendMeterValues(1);
		expect(harness.calls('MeterValues')).toHaveLength(1);
		const payload = harness.calls('MeterValues')[0]![3] as Record<string, unknown>;
		expect(payload['evseId']).toBe(1);
		expect(Array.isArray(payload['meterValue'])).toBe(true);
		await expect(harness.simulator.sendMeterValues(99)).rejects.toMatchObject({
			code: 'invalid-options',
		});
	});

	it('stops meter loops on disconnect', async () => {
		const harness = createHarness201();
		await harness.ready();
		await harness.simulator.startChargingSession(1, 'A');
		const before = harness.calls('TransactionEvent').length;
		harness.simulator.disconnect();
		harness.clock.advance(120_000);
		await flushMicrotasks(40);
		expect(harness.calls('TransactionEvent').length).toBe(before);
	});

	it('validates helpers and station bounds', async () => {
		const harness = createHarness201({ evseCount: 20, power: -5 });
		await harness.ready();
		expect(harness.simulator.state.evses).toHaveLength(8);
		expect(harness.simulator.getEvse(1)?.chargingPowerKw).toBe(0);
		expect(harness.simulator.getEvse(99)).toBeUndefined();
		await expect(harness.simulator.sendStatusNotification(99)).rejects.toMatchObject({
			code: 'invalid-options',
		});
		await expect(
			harness.simulator.sendTransactionEvent(1, 'Updated', 'Trigger'),
		).rejects.toMatchObject({ code: 'invalid-options' });
		harness.simulator.setEvseStatus(99, 'Faulted');
		harness.simulator.setChargingPowerKw(1, Number.NaN);
		expect(harness.simulator.getEvse(1)?.chargingPowerKw).toBe(0);
		await harness.simulator.sendStatusNotification(1);
		expect(harness.calls('StatusNotification').length).toBeGreaterThanOrEqual(9);
		harness.simulator.dispose();

		const single = createHarness201({ evseCount: Number.NaN });
		await single.ready();
		expect(single.simulator.state.evses).toHaveLength(1);
		single.simulator.dispose();
	});

	it('reads replies with a payload helper', async () => {
		const harness = createHarness201();
		await harness.ready();
		harness.incoming('probe', 'ClearCache', {});
		await harness.ready();
		expect(framePayload(harness.reply('probe'))).toEqual({ status: 'Accepted' });
		expect(framePayload(undefined)).toEqual({});
	});
});
