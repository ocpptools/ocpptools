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

describe('Simulator201 real security integration', () => {
	it('uses an injected certificate validator for install and signed chains', async () => {
		const calls: Array<{ chain: readonly string[]; purpose: string; now: number }> = [];
		const hash = {
			hashAlgorithm: 'SHA256' as const,
			issuerNameHash: 'issuer-real',
			issuerKeyHash: 'key-real',
			serialNumber: '01AB',
		};
		const harness = createHarness201({
			security: {
				validateCertificateChain: (chain, purpose, context) => {
					calls.push({ chain, purpose, now: context.now });
					return Promise.resolve({ valid: true, errors: [], hashData: hash });
				},
			},
		});
		await harness.ready();

		expect(
			await call(harness, 'real-1', 'InstallCertificate', {
				certificateType: 'CSMSRootCertificate',
				certificate: '-----BEGIN CERTIFICATE-----real-----END CERTIFICATE-----',
			}),
		).toEqual({ status: 'Accepted' });
		expect(harness.simulator.state.security.certificates[0]?.hash).toMatchObject(hash);
		const chain = '-----BEGIN CERTIFICATE-----signed-----END CERTIFICATE-----';
		expect(
			await call(harness, 'real-2', 'CertificateSigned', {
				certificateChain: chain,
				certificateType: 'V2GCertificate',
			}),
		).toEqual({ status: 'Accepted' });
		expect(calls).toHaveLength(2);
		expect(calls[0]).toMatchObject({
			chain: ['-----BEGIN CERTIFICATE-----real-----END CERTIFICATE-----'],
			purpose: 'CSMSRootCertificate',
		});
		expect(calls[1]).toMatchObject({ chain: [chain], purpose: 'V2GCertificate' });
		expect(typeof calls[0]?.now).toBe('number');
	});

	it('rejects invalid certificates and chains in real mode', async () => {
		const harness = createHarness201({
			security: {
				mode: 'real',
				validateCertificateChain: () =>
					Promise.resolve({ valid: false, errors: ['invalid chain'] }),
			},
		});
		await harness.ready();

		expect(
			await call(harness, 'real-bad-1', 'InstallCertificate', {
				certificateType: 'CSMSRootCertificate',
				certificate: 'cert',
			}),
		).toEqual({ status: 'Rejected' });
		expect(
			await call(harness, 'real-bad-2', 'CertificateSigned', {
				certificateChain: '-----BEGIN CERTIFICATE-----invalid-----END CERTIFICATE-----',
			}),
		).toEqual({ status: 'Rejected' });
		expect(harness.simulator.state.security.certificates).toHaveLength(0);
		expect(harness.simulator.state.security.signedChains).toEqual({});
	});

	it('rejects throwing validators and invalid hash data', async () => {
		const throwing = createHarness201({
			security: {
				mode: 'real',
				validateCertificateChain: () => Promise.reject(new Error('validator failed')),
			},
		});
		await throwing.ready();
		expect(
			await call(throwing, 'throw-1', 'InstallCertificate', {
				certificateType: 'CSMSRootCertificate',
				certificate: 'cert',
			}),
		).toEqual({ status: 'Rejected' });
		expect(
			await call(throwing, 'throw-2', 'CertificateSigned', { certificateChain: 'chain' }),
		).toEqual({ status: 'Rejected' });

		const missingHash = createHarness201({
			security: {
				mode: 'real',
				validateCertificateChain: () => Promise.resolve({ valid: true, errors: [] }),
			},
		});
		await missingHash.ready();
		expect(
			await call(missingHash, 'hash-1', 'InstallCertificate', {
				certificateType: 'CSMSRootCertificate',
				certificate: 'cert',
			}),
		).toEqual({ status: 'Rejected' });
	});

	it('validates and stores only PEM blocks from a signed chain', async () => {
		let received: readonly string[] = [];
		const harness = createHarness201({
			security: {
				mode: 'real',
				validateCertificateChain: (chain) => {
					received = chain;
					return Promise.resolve({ valid: true, errors: [] });
				},
			},
		});
		await harness.ready();
		const first = '-----BEGIN CERTIFICATE-----a-----END CERTIFICATE-----';
		const second = '-----BEGIN CERTIFICATE-----b-----END CERTIFICATE-----';
		expect(
			await call(harness, 'pem-1', 'CertificateSigned', {
				certificateChain: `${first}\n${second}`,
			}),
		).toEqual({ status: 'Accepted' });
		expect(received).toEqual([first, second]);
		expect(harness.simulator.state.security.signedChains['ChargingStationCertificate']).toBe(
			`${first}\n${second}`,
		);

		expect(
			await call(harness, 'pem-2', 'CertificateSigned', {
				certificateChain: `${first}\n-----BEGIN PRIVATE KEY-----secret-----END PRIVATE KEY-----`,
			}),
		).toEqual({ status: 'Rejected' });
	});

	it('rejects private key blocks in simulated mode', async () => {
		const harness = createHarness201();
		await harness.ready();
		const privateKeys = [
			'-----BEGIN PGP PRIVATE KEY BLOCK-----secret-----END PGP PRIVATE KEY BLOCK-----',
			'-----BEGIN -----BEGIN RSA PRIVATE KEY-----secret-----END RSA PRIVATE KEY-----',
			'-----begin rsa private key-----secret-----end rsa private key-----',
		];
		for (const [index, privateKey] of privateKeys.entries()) {
			expect(
				await call(harness, `sim-key-install-${String(index)}`, 'InstallCertificate', {
					certificateType: 'CSMSRootCertificate',
					certificate: privateKey,
				}),
			).toEqual({ status: 'Rejected' });
			expect(
				await call(harness, `sim-key-signed-${String(index)}`, 'CertificateSigned', {
					certificateChain: privateKey,
				}),
			).toEqual({ status: 'Rejected' });
		}
		expect(harness.simulator.state.security.certificates).toHaveLength(0);
		expect(harness.simulator.state.security.signedChains).toEqual({});
		expect(harness.calls('SecurityEventNotification')).toHaveLength(0);
	});

	it('does not call a validator for non-PEM signed chains', async () => {
		let calls = 0;
		const harness = createHarness201({
			security: {
				mode: 'real',
				validateCertificateChain: () => {
					calls += 1;
					return Promise.resolve({ valid: true, errors: [] });
				},
			},
		});
		await harness.ready();
		expect(
			await call(harness, 'non-pem-1', 'CertificateSigned', {
				certificateChain: 'not-a-certificate',
			}),
		).toEqual({ status: 'Rejected' });
		expect(calls).toBe(0);
		expect(harness.simulator.state.security.signedChains).toEqual({});
	});

	it('rejects snapshots that contain private key material in security state', async () => {
		const harness = createHarness201();
		await harness.ready();
		interface SnapshotShape {
			state: {
				security: {
					certificates: Array<Record<string, unknown>>;
					signedChains: Record<string, string>;
					events: Array<Record<string, unknown>>;
				};
			};
		}
		const snapshot = harness.simulator.exportSnapshot() as unknown as SnapshotShape;
		snapshot.state.security.certificates.push({
			certificateType: 'CSMSRootCertificate',
			certificate: '-----BEGIN PRIVATE KEY-----secret-----END PRIVATE KEY-----',
			hash: {
				hashAlgorithm: 'SHA256',
				issuerNameHash: 'issuer',
				issuerKeyHash: 'key',
				serialNumber: '01',
			},
			installedAt: 1,
		});
		const result = harness.simulator.restoreSnapshot(snapshot);
		expect(result.restored).toBe(false);
		expect(result.error?.code).toBe('invalid-snapshot');

		const hostile = [
			'-----BEGIN -----BEGIN RSA PRIVATE KEY-----secret-----END RSA PRIVATE KEY-----',
			'-----begin rsa private key-----secret-----end rsa private key-----',
		];
		for (const secret of hostile) {
			const next = harness.simulator.exportSnapshot() as unknown as SnapshotShape;
			next.state.security.signedChains['ChargingStationCertificate'] = secret;
			const signedResult = harness.simulator.restoreSnapshot(next);
			expect(signedResult.restored).toBe(false);
			expect(signedResult.error?.code).toBe('invalid-snapshot');
		}

		const fields: Array<(snapshot: SnapshotShape) => void> = [
			(next) => {
				next.state.security.certificates[0]!['certificateType'] = hostile[0];
			},
			(next) => {
				const hash = next.state.security.certificates[0]!['hash'] as Record<string, unknown>;
				hash['issuerNameHash'] = hostile[0];
			},
			(next) => {
				next.state.security.signedChains[hostile[0]!] = 'chain';
			},
			(next) => {
				next.state.security.events.push({ type: hostile[0]!, timestamp: '2020-01-01T00:00:00Z' });
			},
		];
		for (const mutate of fields) {
			const next = harness.simulator.exportSnapshot() as unknown as SnapshotShape;
			next.state.security.certificates = [
				{
					certificateType: 'CSMSRootCertificate',
					certificate: 'cert',
					hash: {
						hashAlgorithm: 'SHA256',
						issuerNameHash: 'issuer',
						issuerKeyHash: 'key',
						serialNumber: '01',
					},
					installedAt: 1,
				},
			];
			mutate(next);
			const fieldResult = harness.simulator.restoreSnapshot(next);
			expect(fieldResult.restored).toBe(false);
			expect(fieldResult.error?.code).toBe('invalid-snapshot');
		}
	});

	it('round-trips accepted empty security strings', async () => {
		const harness = createHarness201();
		await harness.ready();
		await harness.simulator.sendSecurityEvent('Startup', '');
		expect(harness.simulator.restoreSnapshot(harness.simulator.exportSnapshot())).toEqual({
			restored: true,
		});
	});

	it('rejects private key material in security event text', async () => {
		const harness = createHarness201();
		await harness.ready();
		for (const privateKey of [
			'-----BEGIN PRIVATE KEY-----secret-----END PRIVATE KEY-----',
			'-----BEGIN -----BEGIN RSA PRIVATE KEY-----secret-----END RSA PRIVATE KEY-----',
			'-----begin rsa private key-----secret-----end rsa private key-----',
		]) {
			await expect(
				harness.simulator.sendSecurityEvent('FirmwareUpdated', privateKey),
			).rejects.toThrow('private key');
		}
		expect(harness.simulator.state.security.events).toHaveLength(0);
		await harness.simulator.sendSecurityEvent('FirmwareUpdated', 'firmware verified');
		expect(harness.simulator.state.security.events).toHaveLength(1);
	});

	it('requires explicit real mode when a validator is present', () => {
		expect(() =>
			createHarness201({
				security: {
					mode: 'simulated',
					validateCertificateChain: () => Promise.resolve({ valid: true, errors: [] }),
				},
			}),
		).toThrow('real security mode');
	});

	it('requires a validator when real mode is selected', () => {
		expect(() => createHarness201({ security: { mode: 'real' } })).toThrow(
			'validateCertificateChain',
		);
	});
});

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
		expect(
			await harness.simulator.sendSignCertificate(
				'-----BEGIN CERTIFICATE REQUEST-----\nMIIB\n-----END CERTIFICATE REQUEST-----',
			),
		).toMatchObject({
			status: 'Accepted',
		});
		expect(
			await harness.simulator.sendGet15118EVCertificate('iso2', 'Install', 'exi'),
		).toMatchObject({ status: 'Accepted', exiResponse: 'exi-response' });
		expect(
			await harness.simulator.sendGetCertificateStatus(ocspData('1') as JsonObject),
		).toMatchObject({ status: 'Accepted', ocspResult: 'ocsp-response' });
		await harness.simulator.sendSecurityEvent('FirmwareUpdated', '1.0.0');
		expect(harness.calls('SignCertificate')[0]![3]).toEqual({
			csr: '-----BEGIN CERTIFICATE REQUEST-----\nMIIB\n-----END CERTIFICATE REQUEST-----',
		});
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
