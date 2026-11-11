// SPDX-License-Identifier: Apache-2.0
// SPDX-FileCopyrightText: 2026 Rodolfo Carrillo

import { describe, expect, it } from 'vitest';

import {
	createHarness16,
	framePayload16,
	installResponder16,
	type Harness16,
} from './helpers/simulator-16.js';
import { expectSchemaValid } from './helpers/schema-validator.js';

const CP_TO_CSMS = [
	'Authorize',
	'BootNotification',
	'DataTransfer',
	'DiagnosticsStatusNotification',
	'FirmwareStatusNotification',
	'Heartbeat',
	'MeterValues',
	'StartTransaction',
	'StatusNotification',
	'StopTransaction',
] as const;

const CSMS_TO_CP = [
	'CancelReservation',
	'ChangeAvailability',
	'ChangeConfiguration',
	'ClearCache',
	'ClearChargingProfile',
	'GetCompositeSchedule',
	'GetConfiguration',
	'GetDiagnostics',
	'GetLocalListVersion',
	'RemoteStartTransaction',
	'RemoteStopTransaction',
	'ReserveNow',
	'Reset',
	'SendLocalList',
	'SetChargingProfile',
	'TriggerMessage',
	'UnlockConnector',
	'UpdateFirmware',
] as const;

async function call(
	harness: Harness16,
	messageId: string,
	action: string,
	payload: Record<string, unknown>,
): Promise<Record<string, unknown>> {
	harness.incoming(messageId, action, payload);
	await harness.ready(80);
	const reply = harness.reply(messageId);
	expect(
		reply,
		`${action} did not reply. Sent: ${JSON.stringify(harness.sent().map((frame) => frame.slice(0, 3)))}`,
	).toBeDefined();
	expect(reply?.[0], `${action} did not return a CALLRESULT`).toBe(3);
	expect(reply?.[2], `${action} is not implemented`).not.toBe('NotImplemented');
	if (reply !== undefined) await expectSchemaValid('1.6', reply, action);
	return framePayload16(reply);
}

describe('Simulator16 integrated session', () => {
	it('uses the 10 + 18 = 28 action matrix', () => {
		expect(CP_TO_CSMS).toHaveLength(10);
		expect(CSMS_TO_CP).toHaveLength(18);
		expect(new Set([...CP_TO_CSMS, ...CSMS_TO_CP]).size).toBe(28);
	});

	it('runs all 28 OCPP 1.6J actions in one session', async () => {
		const harness = createHarness16();
		await harness.ready();
		expect(harness.simulator.isReady).toBe(true);

		// 10 CP -> CSMS actions. DataTransfer is bidirectional and is counted
		// here, once, to keep the 10 + 18 = 28 matrix.
		await harness.simulator.bootNotification({ force: true });
		await harness.simulator.sendHeartbeat();
		await harness.simulator.sendStatusNotification(1, 'Available');
		await harness.simulator.authorize('A');
		await harness.simulator.startChargingSession(1, 'A');
		await harness.simulator.sendMeterValues(1);
		await harness.simulator.stopTransaction(1);
		await harness.simulator.sendDiagnosticsStatus('Idle');
		await harness.simulator.sendFirmwareStatus('Idle');
		await harness.simulator.sendDataTransfer({ vendorId: 'x' });
		await harness.ready(80);

		const outbound = new Set(harness.calls().map((frame) => frame[2]));
		for (const action of CP_TO_CSMS) {
			expect(outbound.has(action), `missing outbound ${action}`).toBe(true);
		}
		for (const frame of harness.calls()) await expectSchemaValid('1.6', frame);

		// 18 CSMS -> CP actions. Reset is last because it reboots the engine.
		const inbound: Record<(typeof CSMS_TO_CP)[number], Record<string, unknown>> = {
			RemoteStartTransaction: { connectorId: 1, idTag: 'A' },
			GetConfiguration: {},
			ChangeConfiguration: { key: 'HeartbeatInterval', value: '30' },
			GetCompositeSchedule: { connectorId: 1, duration: 60 },
			SetChargingProfile: {
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
			ClearChargingProfile: {},
			SendLocalList: {
				listVersion: 1,
				updateType: 'Full',
				localAuthorizationList: [{ idTag: 'A', idTagInfo: { status: 'Accepted' } }],
			},
			GetLocalListVersion: {},
			ReserveNow: {
				connectorId: 2,
				expiryDate: '2030-01-01T00:00:00Z',
				idTag: 'A',
				reservationId: 1,
			},
			CancelReservation: { reservationId: 1 },
			UnlockConnector: { connectorId: 2 },
			ChangeAvailability: { connectorId: 2, type: 'Inoperative' },
			TriggerMessage: { requestedMessage: 'Heartbeat' },
			GetDiagnostics: { location: 'https://example.com/diagnostics' },
			UpdateFirmware: {
				retrieveDate: '2030-01-01T00:00:00Z',
				location: 'https://example.com/firmware',
			},
			ClearCache: {},
			RemoteStopTransaction: { transactionId: 1 },
			Reset: { type: 'Hard' },
		};

		const inboundOrder = [
			'RemoteStartTransaction',
			'GetConfiguration',
			'ChangeConfiguration',
			'GetCompositeSchedule',
			'SetChargingProfile',
			'ClearChargingProfile',
			'SendLocalList',
			'GetLocalListVersion',
			'ReserveNow',
			'CancelReservation',
			'UnlockConnector',
			'ChangeAvailability',
			'TriggerMessage',
			'GetDiagnostics',
			'UpdateFirmware',
			'ClearCache',
			'RemoteStopTransaction',
			'Reset',
		] as const;
		expect(new Set(inboundOrder)).toEqual(new Set(CSMS_TO_CP));
		for (const action of inboundOrder) {
			await call(harness, `in-${action}`, action, inbound[action]);
		}
		await harness.ready(120);
		expect(harness.factory.transports.length).toBe(2);
		const second = harness.factory.transports[1]!;
		installResponder16(second);
		second.open();
		await harness.ready(160);
		expect(second.sent.some((text) => text.includes('BootNotification'))).toBe(true);
		expect(harness.simulator.isReady).toBe(true);

		harness.simulator.dispose();
	});
});
