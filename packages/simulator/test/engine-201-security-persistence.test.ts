// SPDX-License-Identifier: Apache-2.0
// SPDX-FileCopyrightText: 2026 Rodolfo Carrillo

import { describe, expect, it } from 'vitest';

import { createHarness201, framePayload, type Harness201 } from './helpers/simulator-201.js';

const CERT = '-----BEGIN CERTIFICATE-----persisted-----END CERTIFICATE-----';

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

describe('Simulator201 security persistence', () => {
	it('stores public security state but not callbacks, trust stores or key references', async () => {
		const harness = createHarness201({
			security: {
				mode: 'real',
				trustStore: { roots: { CSMSRootCertificate: [CERT] } },
				validateCertificateChain: () =>
					Promise.resolve({
						valid: true,
						errors: [],
						hashData: {
							hashAlgorithm: 'SHA256',
							issuerNameHash: 'issuer',
							issuerKeyHash: 'key',
							serialNumber: '01',
						},
					}),
				revocation: { check: () => Promise.resolve({ status: 'good' }) },
				csrProvider: {
					create: () => Promise.resolve({ csrPem: 'csr', keyRef: 'secret-key-ref' }),
				},
				firmwareVerifier: { verify: () => Promise.resolve({ valid: true, errors: [] }) },
				iso15118: {
					encodeRequest: () => Promise.resolve('exi'),
					decodeResponse: () => Promise.resolve({}),
				},
				callbackTimeoutMs: 1000,
			},
		});
		await harness.ready();
		await call(harness, 'persist-install', 'InstallCertificate', {
			certificateType: 'CSMSRootCertificate',
			certificate: CERT,
		});
		await call(harness, 'persist-signed', 'CertificateSigned', { certificateChain: CERT });
		await harness.simulator.sendSecurityEvent('Startup', 'boot');

		const snapshot = harness.simulator.exportSnapshot();
		const text = JSON.stringify(snapshot);
		for (const forbidden of [
			'validateCertificateChain',
			'csrProvider',
			'firmwareVerifier',
			'iso15118',
			'trustStore',
			'revocation',
			'secret-key-ref',
			'callbackTimeoutMs',
			'PRIVATE KEY',
		]) {
			expect(text).not.toContain(forbidden);
		}

		const restored = createHarness201();
		await restored.ready();
		expect(restored.simulator.restoreSnapshot(snapshot)).toEqual({ restored: true });
		expect(restored.simulator.state.security.certificates).toHaveLength(1);
		expect(restored.simulator.state.security.signedChains).toEqual({
			ChargingStationCertificate: CERT,
			V2GCertificate: CERT,
		});
		expect(restored.simulator.state.security.events.at(-1)).toMatchObject({
			type: 'Startup',
			techInfo: 'boot',
		});
	});
});
