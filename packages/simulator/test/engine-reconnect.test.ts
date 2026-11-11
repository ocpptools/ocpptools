// SPDX-License-Identifier: Apache-2.0
// SPDX-FileCopyrightText: 2026 Rodolfo Carrillo

import { describe, expect, it } from 'vitest';

import { createHarness16, installResponder16, type Harness16 } from './helpers/simulator-16.js';
import { createHarness201, installResponder, type Harness201 } from './helpers/simulator-201.js';

async function reconnect16(harness: Harness16) {
	if (harness.transport.state !== 'closed') harness.transport.close(1006, 'lost');
	harness.clock.advance(1000);
	await harness.ready(120);
	const next = harness.factory.transports[1];
	expect(next, 'the reconnect did not create a transport').toBeDefined();
	installResponder16(next!);
	next!.open();
	await harness.ready(160);
	expect(harness.simulator.isReady).toBe(true);
	return next!;
}

async function reconnect201(harness: Harness201) {
	if (harness.transport.state !== 'closed') harness.transport.close(1006, 'lost');
	harness.clock.advance(1000);
	await harness.ready();
	const next = harness.factory.transports[1];
	expect(next, 'the reconnect did not create a transport').toBeDefined();
	installResponder(next!);
	next!.open();
	await harness.ready();
	expect(harness.simulator.isReady).toBe(true);
	return next!;
}

describe('reconnection reconciliation', () => {
	it('keeps a 1.6 transaction, resumes its meter loop, and flushes the queue once', async () => {
		const harness = createHarness16();
		await harness.ready();
		expect(await harness.simulator.transactions.start(1, 'A')).toMatchObject({ ok: true });
		await harness.simulator.sendMeterValues(1);
		harness.transport.close(1006, 'lost');
		expect(await harness.simulator.sendOrQueue('DataTransfer', { vendorId: 'queued' })).toBe(
			'queued',
		);
		const queuedId = harness.simulator.getQueue()[0]?.messageId;

		const next = await reconnect16(harness);
		expect(harness.simulator.transactions.get(1)?.activeTransaction).not.toBeNull();
		expect(harness.simulator.getConnector(1)?.status).toBe('Charging');
		expect(harness.simulator.getQueueLength()).toBe(0);
		const dataTransfers = next.sent.filter((text) => text.includes('"DataTransfer"'));
		expect(dataTransfers).toHaveLength(1);
		expect((JSON.parse(dataTransfers[0]!) as unknown[]).slice(0, 3)).toEqual([
			2,
			queuedId,
			'DataTransfer',
		]);
		expect(next.sent.some((text) => text.includes('"StopTransaction"'))).toBe(false);

		const meters = next.sent.filter((text) => text.includes('"MeterValues"')).length;
		harness.clock.advance(30_000);
		await harness.ready(120);
		expect(next.sent.filter((text) => text.includes('"MeterValues"')).length).toBeGreaterThan(
			meters,
		);
		harness.simulator.dispose();
	});

	it('keeps 1.6 local auth, reservations, and charging profiles', async () => {
		const harness = createHarness16();
		await harness.ready();
		await harness.simulator.transactions.start(1, 'A');
		harness.incoming('rc-list', 'SendLocalList', {
			listVersion: 1,
			updateType: 'Full',
			localAuthorizationList: [{ idTag: 'B', idTagInfo: { status: 'Accepted' } }],
		});
		harness.incoming('rc-profile', 'SetChargingProfile', {
			connectorId: 1,
			csChargingProfiles: {
				chargingProfileId: 1,
				stackLevel: 1,
				chargingProfilePurpose: 'TxDefaultProfile',
				chargingProfileKind: 'Absolute',
				chargingSchedule: {
					chargingRateUnit: 'W',
					duration: 3600,
					chargingSchedulePeriod: [{ startPeriod: 0, limit: 1000 }],
				},
			},
		});
		harness.incoming('rc-reserve', 'ReserveNow', {
			connectorId: 2,
			expiryDate: '2030-01-01T00:00:00Z',
			idTag: 'B',
			reservationId: 1,
		});
		await harness.ready(160);

		await reconnect16(harness);
		expect(harness.simulator.localAuth.getVersion()).toBe(1);
		expect(harness.simulator.localAuth.list()).toHaveLength(1);
		expect(harness.simulator.chargingProfiles.list()).toHaveLength(1);
		expect(harness.simulator.reservations.list()).toHaveLength(1);
		harness.simulator.dispose();
	});

	it('keeps a 2.0.1 transaction and flushes the queue once', async () => {
		const harness = createHarness201();
		await harness.ready();
		await harness.simulator.authorize('A');
		expect(await harness.simulator.startChargingSession(1, 'A')).toMatchObject({ ok: true });
		harness.transport.close(1006, 'lost');
		expect(await harness.simulator.sendOrQueue('DataTransfer', { vendorId: 'queued' })).toBe(
			'queued',
		);

		const next = await reconnect201(harness);
		expect(harness.simulator.transactions.get(1)?.transaction).not.toBeNull();
		expect(harness.simulator.getQueueLength()).toBe(0);
		expect(next.sent.filter((text) => text.includes('"DataTransfer"'))).toHaveLength(1);
		expect(next.sent.some((text) => text.includes('"Ended"'))).toBe(false);
		harness.simulator.dispose();
	});

	it('keeps 2.0.1 local auth, reservations, profiles, and monitoring', async () => {
		const harness = createHarness201();
		await harness.ready();
		await harness.simulator.authorize('A');
		await harness.simulator.startChargingSession(1, 'A');
		harness.incoming('rc201-list', 'SendLocalList', {
			versionNumber: 1,
			updateType: 'Full',
			localAuthorizationList: [{ idToken: { idToken: 'B', type: 'ISO14443' } }],
		});
		harness.incoming('rc201-profile', 'SetChargingProfile', {
			evseId: 1,
			chargingProfile: {
				id: 1,
				stackLevel: 1,
				chargingProfilePurpose: 'TxDefaultProfile',
				chargingProfileKind: 'Absolute',
				chargingSchedule: [
					{
						id: 1,
						chargingRateUnit: 'W',
						chargingSchedulePeriod: [{ startPeriod: 0, limit: 11000 }],
					},
				],
			},
		});
		harness.incoming('rc201-reserve', 'ReserveNow', {
			id: 1,
			expiryDateTime: '2030-01-01T00:00:00Z',
			idToken: { idToken: 'B', type: 'ISO14443' },
		});
		harness.incoming('rc201-monitor', 'SetVariableMonitoring', {
			setMonitoringData: [
				{
					value: 40,
					type: 'UpperThreshold',
					severity: 1,
					component: { name: 'OCPPCommCtrlr' },
					variable: { name: 'HeartbeatInterval' },
				},
			],
		});
		await harness.ready();

		await reconnect201(harness);
		expect(harness.simulator.localAuth.getVersion()).toBe(1);
		expect(harness.simulator.localAuth.list()).toHaveLength(1);
		expect(harness.simulator.chargingProfiles.list()).toHaveLength(1);
		expect(harness.simulator.reservations.list()).toHaveLength(1);
		expect(harness.simulator.monitoring.list()).toHaveLength(1);
		harness.simulator.dispose();
	});

	it('keeps a pending 2.0.1 OnIdle reset and runs it after the transaction ends', async () => {
		const harness = createHarness201();
		await harness.ready();
		await harness.simulator.authorize('A');
		await harness.simulator.startChargingSession(1, 'A');
		harness.incoming('rc201-reset', 'Reset', { type: 'OnIdle' });
		await harness.ready();
		expect(harness.reply('rc201-reset')?.[2]).toEqual({ status: 'Scheduled' });

		await reconnect201(harness);
		expect(harness.simulator.transactions.get(1)?.transaction).not.toBeNull();
		await harness.simulator.stopTransaction(1, 'Local');
		harness.clock.advance(1000);
		await harness.ready();
		expect(harness.factory.transports.length).toBe(3);
		harness.simulator.dispose();
	});

	it('does not duplicate history when a session reconnects', async () => {
		const harness = createHarness16();
		await harness.ready();
		await harness.simulator.sendHeartbeat();
		const bootsBefore = harness.simulator
			.getHistory()
			.filter((entry) => entry.direction === 'sent' && entry.action === 'BootNotification').length;
		const heartbeatsBefore = harness.simulator
			.getHistory()
			.filter((entry) => entry.direction === 'sent' && entry.action === 'Heartbeat').length;

		await reconnect16(harness);
		await harness.simulator.sendHeartbeat();
		expect(
			harness.simulator
				.getHistory()
				.filter((entry) => entry.direction === 'sent' && entry.action === 'BootNotification'),
		).toHaveLength(bootsBefore + 1);
		expect(
			harness.simulator
				.getHistory()
				.filter((entry) => entry.direction === 'sent' && entry.action === 'Heartbeat'),
		).toHaveLength(heartbeatsBefore + 1);
		harness.simulator.dispose();
	});
});
