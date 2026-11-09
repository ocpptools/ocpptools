// SPDX-License-Identifier: Apache-2.0
// SPDX-FileCopyrightText: 2026 Rodolfo Carrillo

import { describe, expect, it } from 'vitest';

import { createHarness201, framePayload, type Harness201 } from './helpers/simulator-201.js';
import { expectSchemaValid } from './helpers/schema-validator.js';

async function call(
	harness: Harness201,
	messageId: string,
	action: string,
	payload: Record<string, unknown>,
): Promise<Record<string, unknown>> {
	harness.incoming(messageId, action, payload);
	await harness.ready();
	const reply = harness.reply(messageId);
	expect(reply, `${action} did not reply`).toBeDefined();
	expect(reply?.[2], `${action} is not implemented`).not.toBe('NotImplemented');
	if (reply !== undefined) await expectSchemaValid('2.0.1', reply, action);
	return framePayload(reply);
}

describe('Simulator201 integrated session', () => {
	it('runs a full session against one CSMS connection', async () => {
		const harness = createHarness201();
		await harness.ready();
		await harness.simulator.authorize('A');
		await harness.simulator.startChargingSession(1, 'A');
		await harness.simulator.sendMeterValues(1);

		await call(harness, 'session-vars', 'GetVariables', {
			getVariableData: [
				{ component: { name: 'OCPPCommCtrlr' }, variable: { name: 'HeartbeatInterval' } },
			],
		});
		await call(harness, 'session-set-vars', 'SetVariables', {
			setVariableData: [
				{
					component: { name: 'OCPPCommCtrlr' },
					variable: { name: 'HeartbeatInterval' },
					attributeValue: '60',
				},
			],
		});
		await call(harness, 'session-monitor', 'SetVariableMonitoring', {
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
		await call(harness, 'session-monitor-report', 'GetMonitoringReport', { requestId: 1 });
		await call(harness, 'session-report', 'GetReport', { requestId: 2 });
		await call(harness, 'session-base-report', 'GetBaseReport', {
			requestId: 3,
			reportBase: 'FullInventory',
		});

		await call(harness, 'session-display', 'SetDisplayMessage', {
			message: {
				id: 1,
				priority: 'NormalCycle',
				message: { format: 'UTF8', content: 'hello' },
			},
		});
		await call(harness, 'session-display-get', 'GetDisplayMessages', { requestId: 4 });
		await call(harness, 'session-display-clear', 'ClearDisplayMessage', { id: 1 });

		await call(harness, 'session-profile', 'SetChargingProfile', {
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
		await call(harness, 'session-profiles', 'GetChargingProfiles', {
			requestId: 5,
			chargingProfile: {},
		});
		await call(harness, 'session-composite', 'GetCompositeSchedule', {
			evseId: 1,
			duration: 60,
		});

		await call(harness, 'session-local-version', 'GetLocalListVersion', {});
		await call(harness, 'session-local-send', 'SendLocalList', {
			versionNumber: 2,
			updateType: 'Differential',
			localAuthorizationList: [{ idToken: { idToken: 'B', type: 'ISO14443' } }],
		});
		await call(harness, 'session-reserve', 'ReserveNow', {
			id: 1,
			expiryDateTime: '2030-01-01T00:00:00Z',
			idToken: { idToken: 'A', type: 'ISO14443' },
		});
		await call(harness, 'session-reserve-cancel', 'CancelReservation', { reservationId: 1 });
		await call(harness, 'session-availability', 'ChangeAvailability', {
			operationalStatus: 'Operative',
		});
		await call(harness, 'session-unlock', 'UnlockConnector', { evseId: 1, connectorId: 1 });

		await harness.simulator.stopTransaction(1, 'Local');
		await call(harness, 'session-start', 'RequestStartTransaction', {
			remoteStartId: 1,
			idToken: { idToken: 'A', type: 'ISO14443' },
		});
		const transactionId = harness.simulator.state.evses[0]?.transaction?.transactionId;
		if (transactionId !== undefined) {
			await call(harness, 'session-stop', 'RequestStopTransaction', { transactionId });
		}

		await call(harness, 'session-install', 'InstallCertificate', {
			certificateType: 'CSMSRootCertificate',
			certificate: 'cert',
		});
		await call(harness, 'session-signed', 'CertificateSigned', { certificateChain: 'chain' });
		await call(harness, 'session-certificates', 'GetInstalledCertificateIds', {});
		await call(harness, 'session-publish', 'PublishFirmware', {
			location: 'https://example.com/fw.bin',
			checksum: 'abc',
			requestId: 6,
		});
		await call(harness, 'session-log', 'GetLog', {
			requestId: 7,
			logType: 'SecurityLog',
			log: { remoteLocation: 'https://example.com/logs' },
		});
		await call(harness, 'session-network', 'SetNetworkProfile', {
			configurationSlot: 1,
			connectionData: {
				ocppVersion: 'OCPP20',
				ocppTransport: 'JSON',
				ocppCsmsUrl: 'wss://example.com',
				messageTimeout: 30,
				securityProfile: 1,
				ocppInterface: 'Wired0',
			},
		});
		await call(harness, 'session-customer', 'CustomerInformation', {
			requestId: 8,
			report: false,
			clear: false,
			idToken: { idToken: 'A', type: 'ISO14443' },
		});
		await call(harness, 'session-transfer', 'DataTransfer', { vendorId: 'x' });
		await call(harness, 'session-heartbeat', 'TriggerMessage', {
			requestedMessage: 'Heartbeat',
		});
		await call(harness, 'session-reset', 'Reset', { type: 'Immediate' });

		expect(
			harness.calls().filter((frame) => frame[2] === 'TransactionEvent').length,
		).toBeGreaterThan(0);
	});
});
