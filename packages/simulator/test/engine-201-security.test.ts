// SPDX-License-Identifier: Apache-2.0
// SPDX-FileCopyrightText: 2026 Rodolfo Carrillo

import { describe, expect, it } from 'vitest';

import type { JsonObject } from '@ocpptools/core';

import { createHarness201, framePayload, type Harness201 } from './helpers/simulator-201.js';

async function call(
	harness: Harness201,
	messageId: string,
	action: string,
	payload: unknown,
): Promise<Record<string, unknown>> {
	harness.incoming(messageId, action, payload);
	await harness.ready();
	return framePayload(harness.reply(messageId));
}

async function errorCall(
	harness: Harness201,
	messageId: string,
	action: string,
	payload: unknown,
): Promise<unknown[]> {
	harness.incoming(messageId, action, payload);
	await harness.ready();
	return harness.reply(messageId) ?? [];
}

function hashData(serialNumber: string): Record<string, unknown> {
	return {
		hashAlgorithm: 'SHA256',
		issuerNameHash: 'issuer',
		issuerKeyHash: 'key',
		serialNumber,
	};
}

function ocspData(serialNumber: string): Record<string, unknown> {
	return { ...hashData(serialNumber), responderURL: 'https://ocsp.example.com' };
}

describe('Simulator201 security', () => {
	it('installs and reports simulated certificates', async () => {
		const harness = createHarness201();
		await harness.ready();
		expect(
			await call(harness, 'cert-1', 'InstallCertificate', {
				certificateType: 'CSMSRootCertificate',
				certificate: '-----BEGIN CERTIFICATE-----simulated',
			}),
		).toEqual({ status: 'Accepted' });
		expect(harness.simulator.state.security.certificates).toHaveLength(1);
		const installed = harness.simulator.state.security.certificates[0]!;
		expect(installed.certificateType).toBe('CSMSRootCertificate');
		const accepted = await call(harness, 'cert-2', 'GetInstalledCertificateIds', {});
		expect(accepted['status']).toBe('Accepted');
		expect(
			(accepted['certificateHashDataChain'] as Array<Record<string, unknown>>)[0],
		).toMatchObject({
			certificateType: 'CSMSRootCertificate',
			certificateHashData: { serialNumber: installed.hash['serialNumber'] },
		});
		expect(
			await call(harness, 'cert-3', 'GetInstalledCertificateIds', {
				certificateType: ['V2GCertificateChain'],
			}),
		).toEqual({ status: 'NotFound' });
		await call(harness, 'cert-4', 'InstallCertificate', {
			certificateType: 'MORootCertificate',
			certificate: 'cert-2',
		});
		const filtered = await call(harness, 'cert-5', 'GetInstalledCertificateIds', {
			certificateType: ['MORootCertificate'],
		});
		expect(filtered['certificateHashDataChain']).toHaveLength(1);
		expect(
			(
				await errorCall(harness, 'cert-6', 'InstallCertificate', {
					certificateType: 'Bogus',
					certificate: 'x',
				})
			).slice(0, 3),
		).toEqual([4, 'cert-6', 'FormatViolation']);
		expect(
			(
				await errorCall(harness, 'cert-7', 'GetInstalledCertificateIds', {
					certificateType: [],
				})
			).slice(0, 3),
		).toEqual([4, 'cert-7', 'FormatViolation']);
	});

	it('deletes certificates by hash', async () => {
		const harness = createHarness201();
		await harness.ready();
		await call(harness, 'del-setup', 'InstallCertificate', {
			certificateType: 'CSMSRootCertificate',
			certificate: 'cert',
		});
		const installedHash = harness.simulator.state.security.certificates[0]!.hash;
		expect(
			await call(harness, 'del-wrong', 'DeleteCertificate', {
				certificateHashData: { ...installedHash, issuerNameHash: 'wrong' },
			}),
		).toEqual({ status: 'NotFound' });
		expect(
			await call(harness, 'del-1', 'DeleteCertificate', {
				certificateHashData: installedHash,
			}),
		).toEqual({ status: 'Accepted' });
		expect(harness.simulator.state.security.certificates).toHaveLength(0);
		expect(
			await call(harness, 'del-2', 'DeleteCertificate', {
				certificateHashData: installedHash,
			}),
		).toEqual({ status: 'NotFound' });
		expect(
			(
				await errorCall(harness, 'del-3', 'DeleteCertificate', {
					certificateHashData: { serialNumber: 'x' },
				})
			).slice(0, 3),
		).toEqual([4, 'del-3', 'FormatViolation']);
	});

	it('accepts a signed certificate chain', async () => {
		const harness = createHarness201();
		await harness.ready();
		expect(
			await call(harness, 'signed-1', 'CertificateSigned', {
				certificateChain: 'chain',
				certificateType: 'ChargingStationCertificate',
			}),
		).toEqual({ status: 'Accepted' });
		expect(harness.simulator.state.security.signedChains['ChargingStationCertificate']).toBe(
			'chain',
		);
		expect(harness.simulator.state.security.events[0]?.type).toBe('CertificateSigned');
		expect(
			(await errorCall(harness, 'signed-2', 'CertificateSigned', { certificateChain: 1 })).slice(
				0,
				3,
			),
		).toEqual([4, 'signed-2', 'FormatViolation']);
		expect(
			(
				await errorCall(harness, 'signed-3', 'CertificateSigned', {
					certificateChain: 'chain',
					certificateType: 'Bogus',
				})
			).slice(0, 3),
		).toEqual([4, 'signed-3', 'FormatViolation']);
	});

	it('sends certificate and security requests', async () => {
		const harness = createHarness201();
		await harness.ready();
		expect(await harness.simulator.sendSignCertificate('csr')).toMatchObject({
			status: 'Accepted',
		});
		expect(
			await harness.simulator.sendGet15118EVCertificate('iso2', 'Install', 'exi'),
		).toMatchObject({ status: 'Accepted', exiResponse: 'exi-response' });
		expect(
			await harness.simulator.sendGetCertificateStatus(ocspData('1') as JsonObject),
		).toMatchObject({ status: 'Accepted', ocspResult: 'ocsp-response' });
		await harness.simulator.sendSecurityEvent('FirmwareUpdated', '1.0.0');
		expect(harness.calls('SignCertificate')[0]![3]).toEqual({ csr: 'csr' });
		expect(harness.calls('Get15118EVCertificate')[0]![3]).toEqual({
			iso15118SchemaVersion: 'iso2',
			action: 'Install',
			exiRequest: 'exi',
		});
		expect(
			(harness.calls('GetCertificateStatus')[0]![3] as Record<string, unknown>)['ocspRequestData'],
		).toMatchObject({ serialNumber: '1', responderURL: 'https://ocsp.example.com' });
		const event = harness.calls('SecurityEventNotification')[0]![3] as Record<string, unknown>;
		expect(event).toMatchObject({
			type: 'FirmwareUpdated',
			techInfo: '1.0.0',
		});
		expect(harness.simulator.state.security.events.at(-1)?.type).toBe('FirmwareUpdated');
	});

	it('uses the reject mode for security commands', async () => {
		const harness = createHarness201();
		await harness.ready();
		harness.simulator.setInboundResponseMode('reject');
		expect(
			await call(harness, 'srej-cert-1', 'InstallCertificate', {
				certificateType: 'CSMSRootCertificate',
				certificate: 'x',
			}),
		).toEqual({ status: 'Rejected' });
		expect(
			await call(harness, 'srej-cert-2', 'DeleteCertificate', {
				certificateHashData: hashData('1'),
			}),
		).toEqual({ status: 'Failed' });
		expect(await call(harness, 'srej-cert-3', 'GetInstalledCertificateIds', {})).toEqual({
			status: 'NotFound',
		});
		expect(
			await call(harness, 'srej-cert-4', 'CertificateSigned', { certificateChain: 'x' }),
		).toEqual({ status: 'Rejected' });
	});

	it('queues security events before boot', async () => {
		const harness = createHarness201({
			bootStatus: 'Pending',
			boot: { auto: true, required: true, retryOnPending: false },
		});
		await harness.ready();
		await harness.simulator.sendSecurityEvent('Startup');
		expect(harness.calls('SecurityEventNotification')).toHaveLength(0);
		expect(
			harness.simulator.getQueue().some((entry) => entry.action === 'SecurityEventNotification'),
		).toBe(true);
	});
});
