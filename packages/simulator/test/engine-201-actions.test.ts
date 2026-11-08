// SPDX-License-Identifier: Apache-2.0
// SPDX-FileCopyrightText: 2026 Rodolfo Carrillo

import { describe, expect, it } from 'vitest';

import { createHarness201, type Harness201 } from './helpers/simulator-201.js';

const INBOUND: Array<[string, Record<string, unknown>]> = [
	['CancelReservation', { reservationId: 1 }],
	['CertificateSigned', { certificateChain: 'chain' }],
	['ChangeAvailability', { operationalStatus: 'Operative' }],
	['ClearCache', {}],
	['ClearChargingProfile', {}],
	['ClearDisplayMessage', { id: 1 }],
	['ClearVariableMonitoring', { id: [1] }],
	['CostUpdated', { totalCost: 1, transactionId: 'T' }],
	[
		'CustomerInformation',
		{
			requestId: 1,
			report: false,
			clear: false,
			idToken: { idToken: 'A', type: 'ISO14443' },
		},
	],
	[
		'DeleteCertificate',
		{
			certificateHashData: {
				hashAlgorithm: 'SHA256',
				issuerNameHash: 'i',
				issuerKeyHash: 'k',
				serialNumber: '1',
			},
		},
	],
	['GetBaseReport', { requestId: 1, reportBase: 'FullInventory' }],
	['GetChargingProfiles', { requestId: 1, chargingProfile: {} }],
	['GetCompositeSchedule', { evseId: 1, duration: 60 }],
	['GetDisplayMessages', { requestId: 1 }],
	['GetInstalledCertificateIds', {}],
	['GetLocalListVersion', {}],
	['GetLog', { requestId: 1, logType: 'SecurityLog', log: { remoteLocation: 'https://x' } }],
	['GetMonitoringReport', { requestId: 1 }],
	['GetReport', { requestId: 1 }],
	['GetTransactionStatus', {}],
	[
		'GetVariables',
		{
			getVariableData: [
				{
					component: { name: 'OCPPCommCtrlr' },
					variable: { name: 'HeartbeatInterval' },
				},
			],
		},
	],
	['InstallCertificate', { certificateType: 'CSMSRootCertificate', certificate: 'x' }],
	['PublishFirmware', { location: 'x', checksum: 'a', requestId: 1 }],
	['RequestStartTransaction', { remoteStartId: 1, idToken: { idToken: 'A', type: 'ISO14443' } }],
	['RequestStopTransaction', { transactionId: 'none' }],
	[
		'ReserveNow',
		{
			id: 1,
			expiryDateTime: '2030-01-01T00:00:00Z',
			idToken: { idToken: 'A', type: 'ISO14443' },
		},
	],
	['Reset', { type: 'Immediate' }],
	['SendLocalList', { versionNumber: 1, updateType: 'Full' }],
	[
		'SetChargingProfile',
		{
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
		},
	],
	[
		'SetDisplayMessage',
		{
			message: {
				id: 1,
				priority: 'NormalCycle',
				message: { format: 'UTF8', content: 'x' },
			},
		},
	],
	['SetMonitoringBase', { monitoringBase: 'All' }],
	['SetMonitoringLevel', { severity: 3 }],
	[
		'SetNetworkProfile',
		{
			configurationSlot: 1,
			connectionData: {
				ocppVersion: 'OCPP20',
				ocppTransport: 'JSON',
				ocppCsmsUrl: 'wss://example.com',
				messageTimeout: 30,
				securityProfile: 1,
				ocppInterface: 'Wired0',
			},
		},
	],
	[
		'SetVariableMonitoring',
		{
			setMonitoringData: [
				{
					value: 40,
					type: 'UpperThreshold',
					severity: 1,
					component: { name: 'OCPPCommCtrlr' },
					variable: { name: 'HeartbeatInterval' },
				},
			],
		},
	],
	[
		'SetVariables',
		{
			setVariableData: [
				{
					component: { name: 'OCPPCommCtrlr' },
					variable: { name: 'HeartbeatInterval' },
					attributeValue: '60',
				},
			],
		},
	],
	['TriggerMessage', { requestedMessage: 'Heartbeat' }],
	['UnlockConnector', { evseId: 1, connectorId: 1 }],
	['UnpublishFirmware', { checksum: 'a' }],
	[
		'UpdateFirmware',
		{
			requestId: 1,
			firmware: { location: 'x', retrieveDateTime: '2030-01-01T00:00:00Z' },
		},
	],
	['DataTransfer', { vendorId: 'x' }],
];

const OUTBOUND = [
	'Authorize',
	'BootNotification',
	'ClearedChargingLimit',
	'DataTransfer',
	'FirmwareStatusNotification',
	'Get15118EVCertificate',
	'GetCertificateStatus',
	'Heartbeat',
	'LogStatusNotification',
	'MeterValues',
	'NotifyChargingLimit',
	'NotifyCustomerInformation',
	'NotifyDisplayMessages',
	'NotifyEVChargingNeeds',
	'NotifyEVChargingSchedule',
	'NotifyEvent',
	'NotifyMonitoringReport',
	'NotifyReport',
	'PublishFirmwareStatusNotification',
	'ReportChargingProfiles',
	'ReservationStatusUpdate',
	'SecurityEventNotification',
	'SignCertificate',
	'StatusNotification',
	'TransactionEvent',
];

function calls(harness: Harness201): string[] {
	return harness
		.sent()
		.filter((frame) => frame[0] === 2)
		.map((frame) => String(frame[2]));
}

describe('Simulator201 action matrix', () => {
	it('answers every CSMS action', async () => {
		for (const [action, payload] of INBOUND) {
			const harness = createHarness201();
			await harness.ready();
			harness.incoming(`matrix-${action}`, action, payload);
			await harness.ready();
			const reply = harness.reply(`matrix-${action}`);
			expect(reply, `${action} did not reply`).toBeDefined();
			expect(reply?.[2], `${action} is not implemented`).not.toBe('NotImplemented');
			harness.simulator.dispose();
		}
	});

	it('emits every charging point action', async () => {
		const harness = createHarness201();
		await harness.ready();
		await harness.simulator.authorize('A');
		await harness.simulator.sendClearedChargingLimit('CSO', 1);
		await harness.simulator.sendDataTransfer({ vendorId: 'x' });
		await harness.simulator.sendFirmwareStatus('Idle', 1);
		await harness.simulator.sendGet15118EVCertificate('iso2', 'Install', 'exi');
		await harness.simulator.sendGetCertificateStatus({
			hashAlgorithm: 'SHA256',
			issuerNameHash: 'i',
			issuerKeyHash: 'k',
			serialNumber: '1',
			responderURL: 'https://ocsp.example.com',
		});
		await harness.simulator.sendHeartbeat();
		await harness.simulator.sendLogStatus('Idle', 1);
		await harness.simulator.sendMeterValues(1);
		await harness.simulator.sendNotifyChargingLimit('EMS', 1);
		await harness.simulator.sendNotifyCustomerInformation(1, 'data');
		await harness.simulator.sendNotifyDisplayMessages(1, []);
		await harness.simulator.sendNotifyEVChargingNeeds(1);
		await harness.simulator.sendNotifyEVChargingSchedule(1, {
			id: 1,
			chargingRateUnit: 'W',
			chargingSchedulePeriod: [{ startPeriod: 0, limit: 1000 }],
		});
		await harness.simulator.sendNotifyEvent('OCPPCommCtrlr', 'HeartbeatInterval', '60');
		await harness.simulator.sendPublishFirmwareStatus('Idle', undefined, 1);
		await harness.simulator.sendReservationStatusUpdate(1, 'Removed');
		await harness.simulator.sendSecurityEvent('Startup');
		await harness.simulator.sendSignCertificate('csr');
		await harness.simulator.sendStatusNotification(1);
		await harness.simulator.startChargingSession(1, 'A');

		harness.incoming('matrix-monitor', 'SetVariableMonitoring', {
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
		harness.incoming('matrix-monitor-report', 'GetMonitoringReport', { requestId: 1 });
		harness.incoming('matrix-report', 'GetReport', { requestId: 1 });
		harness.incoming('matrix-profile', 'SetChargingProfile', {
			evseId: 1,
			chargingProfile: {
				id: 2,
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
		harness.incoming('matrix-profiles', 'GetChargingProfiles', {
			requestId: 2,
			chargingProfile: {},
		});
		await harness.ready();

		const sent = calls(harness);
		for (const action of OUTBOUND) {
			expect(sent, `${action} was not emitted`).toContain(action);
		}
	});
});
