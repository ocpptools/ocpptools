// SPDX-License-Identifier: Apache-2.0
// SPDX-FileCopyrightText: 2026 Rodolfo Carrillo

import { readFileSync, readdirSync } from 'node:fs';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';

import { describe, expect, it } from 'vitest';

const testDirectory = fileURLToPath(new URL('.', import.meta.url));
const schemaDirectory = fileURLToPath(new URL('../../schemas/schemas/2.0.1', import.meta.url));

const CP_TO_CSMS = [
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
] as const;

const CSMS_TO_CP = [
	'CancelReservation',
	'CertificateSigned',
	'ChangeAvailability',
	'ClearCache',
	'ClearChargingProfile',
	'ClearDisplayMessage',
	'ClearVariableMonitoring',
	'CostUpdated',
	'CustomerInformation',
	'DeleteCertificate',
	'GetBaseReport',
	'GetChargingProfiles',
	'GetCompositeSchedule',
	'GetDisplayMessages',
	'GetInstalledCertificateIds',
	'GetLocalListVersion',
	'GetLog',
	'GetMonitoringReport',
	'GetReport',
	'GetTransactionStatus',
	'GetVariables',
	'InstallCertificate',
	'PublishFirmware',
	'RequestStartTransaction',
	'RequestStopTransaction',
	'ReserveNow',
	'Reset',
	'SendLocalList',
	'SetChargingProfile',
	'SetDisplayMessage',
	'SetMonitoringBase',
	'SetMonitoringLevel',
	'SetNetworkProfile',
	'SetVariableMonitoring',
	'SetVariables',
	'TriggerMessage',
	'UnlockConnector',
	'UnpublishFirmware',
	'UpdateFirmware',
] as const;

function schemaActions(): string[] {
	return readdirSync(schemaDirectory)
		.filter((file) => file.endsWith('Request.json'))
		.map((file) => file.slice(0, -'Request.json'.length))
		.sort();
}

function coveringFiles(action: string): string[] {
	const needle = `'${action}'`;
	return readdirSync(testDirectory)
		.filter(
			(file) =>
				file.endsWith('.test.ts') &&
				file !== 'engine-201-matrix.test.ts' &&
				file !== 'engine-201-actions.test.ts' &&
				!file.startsWith('engine-16'),
		)
		.filter((file) => readFileSync(join(testDirectory, file), 'utf8').includes(needle));
}

describe('OCPP 2.0.1 action matrix', () => {
	it('partitions every schema action into the 25 + 39 unique-name matrix', () => {
		const actions = schemaActions();
		const cp = new Set<string>(CP_TO_CSMS);
		const csms = new Set<string>(CSMS_TO_CP);
		expect(cp.size).toBe(25);
		expect(csms.size).toBe(39);
		expect(actions).toHaveLength(64);
		// DataTransfer is bidirectional and is counted once, under CP -> CSMS.
		expect([...cp].filter((action) => csms.has(action))).toEqual([]);
		expect(new Set([...cp, ...csms])).toEqual(new Set(actions));
		expect(CP_TO_CSMS).toContain('ReportChargingProfiles');
		expect(CP_TO_CSMS).toContain('Get15118EVCertificate');
		expect(CP_TO_CSMS).toContain('GetCertificateStatus');
		expect(CSMS_TO_CP).toContain('GetReport');
	});

	it('mentions every 2.0.1 action in at least one focused test', () => {
		for (const action of schemaActions()) {
			expect(coveringFiles(action), `no test mentions ${action}`).not.toEqual([]);
		}
	});
});
