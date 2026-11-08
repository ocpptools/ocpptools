// SPDX-License-Identifier: Apache-2.0
// SPDX-FileCopyrightText: 2026 Rodolfo Carrillo

import { describe, expect, it } from 'vitest';

import { Simulator16 } from '../src/1.6.js';
import { FakeClock, flushMicrotasks } from './helpers/fake-clock.js';
import { FakeTransportFactory, type FakeTransport } from './helpers/fake-transport.js';
import { expectSchemaValid } from './helpers/schema-validator.js';

function autoRespond(transport: FakeTransport): void {
	const send = transport.send.bind(transport);
	transport.send = (text: string): void => {
		send(text);
		const frame = JSON.parse(text) as unknown[];
		if (frame[0] !== 2) return;
		const [, id, action] = frame as [number, string, string];
		const responses: Record<string, unknown> = {
			BootNotification: {
				status: 'Accepted',
				currentTime: '2026-01-01T00:00:00Z',
				interval: 60,
			},
			Authorize: { idTagInfo: { status: 'Accepted' } },
			StartTransaction: { transactionId: 1, idTagInfo: { status: 'Accepted' } },
			StopTransaction: { idTagInfo: { status: 'Accepted' } },
			Heartbeat: { currentTime: '2026-01-01T00:00:00Z' },
			DataTransfer: { status: 'Accepted' },
		};
		transport.receive(JSON.stringify([3, id, responses[action] ?? {}]));
	};
}

async function readySimulator(): Promise<{
	clock: FakeClock;
	factory: FakeTransportFactory;
	transport: FakeTransport;
	simulator: Simulator16;
}> {
	const clock = new FakeClock();
	const factory = new FakeTransportFactory();
	let sequence = 0;
	const simulator = new Simulator16({
		url: 'ws://localhost/CP001',
		transport: factory.factory,
		clock,
		messageIds: () => `id-${++sequence}`,
		station: {
			id: 'CP001',
			vendor: 'Acme',
			model: 'AC-7',
			firmwareVersion: '1.0.0',
			connectorCount: 2,
			defaultIdTag: 'AABBCCDD',
		},
	});
	simulator.connect();
	const transport = factory.transports[0]!;
	autoRespond(transport);
	transport.open();
	await flushMicrotasks(60);
	expect(simulator.isReady).toBe(true);
	return { clock, factory, transport, simulator };
}

describe('Simulator16 flows', () => {
	it('runs the charging lifecycle and meter loop', async () => {
		const { simulator, clock, transport } = await readySimulator();
		const started = await simulator.startChargingSession(1, 'A');
		expect(started.ok).toBe(true);
		expect(simulator.getConnector(1)?.status).toBe('Charging');
		clock.advance(30_000);
		await flushMicrotasks(30);
		expect(transport.sent.some((text) => text.includes('MeterValues'))).toBe(true);
		await simulator.stopTransaction(1);
		expect(simulator.getConnector(1)?.status).toBe('Available');
		expect(simulator.getState().completedTransactions).toHaveLength(1);
	});

	it('answers every 1.6 inbound action', async () => {
		const cases: Array<[string, Record<string, unknown>]> = [
			['RemoteStartTransaction', { connectorId: 1, idTag: 'A' }],
			['RemoteStopTransaction', { transactionId: 1 }],
			['ChangeConfiguration', { key: 'HeartbeatInterval', value: '30' }],
			['Reset', { type: 'Hard' }],
			['TriggerMessage', { requestedMessage: 'Heartbeat' }],
			['GetConfiguration', {}],
			['ChangeAvailability', { connectorId: 1, type: 'Operative' }],
			['UnlockConnector', { connectorId: 1 }],
			['ClearCache', {}],
			['GetDiagnostics', {}],
			['UpdateFirmware', {}],
			['GetLocalListVersion', {}],
			[
				'SendLocalList',
				{
					listVersion: 1,
					updateType: 'Full',
					localAuthorizationList: [{ idTag: 'A', idTagInfo: { status: 'Accepted' } }],
				},
			],
			[
				'ReserveNow',
				{ connectorId: 1, expiryDate: '2030-01-01T00:00:00Z', idTag: 'A', reservationId: 1 },
			],
			['CancelReservation', { reservationId: 1 }],
			['DataTransfer', { vendorId: 'x' }],
			[
				'SetChargingProfile',
				{
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
				},
			],
			['ClearChargingProfile', {}],
			['GetCompositeSchedule', { connectorId: 1, duration: 60 }],
		];
		for (const [action, payload] of cases) {
			const { simulator, transport } = await readySimulator();
			const messageId = `in-${action}`;
			simulator.rpc.handleText(JSON.stringify([2, messageId, action, payload]));
			await flushMicrotasks(80);
			const replyText = transport.sent.find((text) => text.startsWith(`[3,"${messageId}"`));
			expect(replyText, `${action} did not reply`).toBeDefined();
			await expectSchemaValid('1.6', JSON.parse(replyText!) as unknown, action);
			simulator.dispose();
		}
	});

	it('emits schema-valid 1.6 charge-point actions', async () => {
		const { simulator, transport } = await readySimulator();
		await simulator.authorize('A');
		await simulator.bootNotification({ force: true });
		await simulator.sendHeartbeat();
		await simulator.sendStatusNotification(1, 'Available');
		await simulator.startChargingSession(1, 'A');
		await simulator.sendMeterValues(1);
		await simulator.stopTransaction(1);
		await simulator.sendDiagnosticsStatus('Idle');
		await simulator.sendFirmwareStatus('Idle');
		await simulator.sendDataTransfer({ vendorId: 'x' });
		const calls = transport.sent
			.map((text) => JSON.parse(text) as unknown[])
			.filter((frame) => frame[0] === 2);
		expect(calls.length).toBeGreaterThanOrEqual(10);
		for (const frame of calls) await expectSchemaValid('1.6', frame);
		simulator.dispose();
	});

	it('honors the inbound reject mode and invalid remote start', async () => {
		const { simulator, transport } = await readySimulator();
		simulator.setInboundResponseMode('reject');
		simulator.rpc.handleText(
			'[2,"reject-1","RemoteStartTransaction",{"connectorId":1,"idTag":"A"}]',
		);
		await flushMicrotasks(30);
		expect(
			transport.sent.some((text) => text.includes('[3,"reject-1",{"status":"Rejected"}]')),
		).toBe(true);
		simulator.setInboundResponseMode('auto');
		simulator.rpc.handleText('[2,"bad-1","RemoteStartTransaction",{"connectorId":99,"idTag":"A"}]');
		await flushMicrotasks(30);
		expect(transport.sent.some((text) => text.includes('[3,"bad-1",{"status":"Rejected"}]'))).toBe(
			true,
		);
	});

	it('schedules availability changes during a transaction', async () => {
		const { simulator, transport } = await readySimulator();
		await simulator.startChargingSession(1, 'A');
		simulator.rpc.handleText(
			'[2,"avail-1","ChangeAvailability",{"connectorId":1,"type":"Inoperative"}]',
		);
		await flushMicrotasks(30);
		expect(
			transport.sent.some((text) => text.includes('[3,"avail-1",{"status":"Scheduled"}]')),
		).toBe(true);
	});

	it('validates local-list versions and reservation conflicts', async () => {
		const { simulator, transport } = await readySimulator();
		await simulator.startChargingSession(1, 'A');
		simulator.rpc.handleText(
			'[2,"list-1","SendLocalList",{"listVersion":0,"updateType":"Differential","localAuthorizationList":[]}]',
		);
		simulator.rpc.handleText(
			'[2,"reserve-1","ReserveNow",{"connectorId":1,"expiryDate":"2030-01-01T00:00:00Z","idTag":"A","reservationId":1}]',
		);
		await flushMicrotasks(30);
		expect(
			transport.sent.some((text) => text.includes('[3,"list-1",{"status":"VersionMismatch"}]')),
		).toBe(true);
		expect(
			transport.sent.some((text) => text.includes('[3,"reserve-1",{"status":"Occupied"}]')),
		).toBe(true);
	});

	it('exposes status, diagnostics, firmware, and data transfer helpers', async () => {
		const { simulator, transport } = await readySimulator();
		await simulator.sendStatusNotification(1, 'Preparing');
		await simulator.sendDiagnosticsStatus('Idle');
		await simulator.sendFirmwareStatus('Idle');
		await simulator.sendDataTransfer({ vendorId: 'x' });
		expect(transport.sent.some((text) => text.includes('DiagnosticsStatusNotification'))).toBe(
			true,
		);
		expect(transport.sent.some((text) => text.includes('FirmwareStatusNotification'))).toBe(true);
		expect(transport.sent.some((text) => text.includes('DataTransfer'))).toBe(true);
		simulator.setConnectorStatus(1, 'Unavailable');
		simulator.setChargingPowerKw(1, 7.4);
		expect(simulator.getConnector(1)).toMatchObject({
			status: 'Unavailable',
			chargingPowerKw: 7.4,
		});
	});
});
