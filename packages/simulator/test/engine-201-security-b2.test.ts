// SPDX-License-Identifier: Apache-2.0
// SPDX-FileCopyrightText: 2026 Rodolfo Carrillo

import { describe, expect, it, vi } from 'vitest';

import type { CertificateHashData201 } from '../src/2.0.1.js';
import { createHarness201, framePayload, type Harness201 } from './helpers/simulator-201.js';

const CSR = '-----BEGIN CERTIFICATE REQUEST-----\nMIIB\n-----END CERTIFICATE REQUEST-----';
const CERT = '-----BEGIN CERTIFICATE-----leaf-----END CERTIFICATE-----';

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

function hashData(serialNumber: string): CertificateHashData201 {
	return {
		hashAlgorithm: 'SHA256',
		issuerNameHash: 'issuer',
		issuerKeyHash: 'key',
		serialNumber,
	};
}

function realSecurity(
	check: (input: {
		chain: readonly string[];
		purpose: string;
		now: number;
	}) => Promise<{ status: 'good' | 'revoked' | 'unknown'; reason?: string }>,
	allowUnknownRevocation = false,
) {
	return {
		mode: 'real' as const,
		validateCertificateChain: () =>
			Promise.resolve({ valid: true, errors: [], hashData: hashData('01') }),
		revocation: { check },
		allowUnknownRevocation,
	};
}

describe('Simulator201 signed certificate revocation', () => {
	it('accepts a good chain and stores it', async () => {
		const seen: Array<{ chain: readonly string[]; purpose: string; now: number }> = [];
		const harness = createHarness201({
			security: realSecurity((input) => {
				seen.push(input);
				return Promise.resolve({ status: 'good' });
			}),
		});
		await harness.ready();
		expect(
			await call(harness, 'rev-good', 'CertificateSigned', {
				certificateChain: CERT,
				certificateType: 'V2GCertificate',
			}),
		).toEqual({ status: 'Accepted' });
		expect(seen).toHaveLength(1);
		expect(seen[0]).toMatchObject({ chain: [CERT], purpose: 'V2GCertificate' });
		expect(typeof seen[0]?.now).toBe('number');
		expect(harness.simulator.state.security.signedChains['V2GCertificate']).toBe(CERT);
		expect(harness.calls('SecurityEventNotification')).toHaveLength(0);
	});

	it('round-trips installed certificates with empty hash fields', async () => {
		const harness = createHarness201({
			security: {
				mode: 'real',
				validateCertificateChain: () =>
					Promise.resolve({
						valid: true,
						errors: [],
						hashData: {
							hashAlgorithm: 'SHA256',
							issuerNameHash: '',
							issuerKeyHash: '',
							serialNumber: '',
						},
					}),
			},
		});
		await harness.ready();
		expect(
			await call(harness, 'empty-hash-install', 'InstallCertificate', {
				certificateType: 'CSMSRootCertificate',
				certificate: CERT,
			}),
		).toEqual({ status: 'Accepted' });
		expect(harness.simulator.restoreSnapshot(harness.simulator.exportSnapshot())).toEqual({
			restored: true,
		});
	});

	it('does not run revocation checks when installing a root', async () => {
		const check = vi.fn(() => Promise.resolve({ status: 'revoked' as const }));
		const harness = createHarness201({
			security: {
				mode: 'real',
				validateCertificateChain: () =>
					Promise.resolve({ valid: true, errors: [], hashData: hashData('03') }),
				revocation: { check },
			},
		});
		await harness.ready();
		expect(
			await call(harness, 'rev-root', 'InstallCertificate', {
				certificateType: 'CSMSRootCertificate',
				certificate: CERT,
			}),
		).toEqual({ status: 'Accepted' });
		expect(check).not.toHaveBeenCalled();
	});

	it('rejects revoked, unknown, malformed and throwing checks without storing', async () => {
		const cases: Array<{
			check: () => Promise<{ status: 'good' | 'revoked' | 'unknown' }>;
		}> = [
			{ check: () => Promise.resolve({ status: 'revoked' }) },
			{ check: () => Promise.resolve({ status: 'unknown' }) },
			{ check: () => Promise.resolve({ status: 'bogus' as never }) },
			{ check: () => Promise.reject(new Error('revocation failed')) },
		];
		for (const [index, entry] of cases.entries()) {
			const harness = createHarness201({ security: realSecurity(entry.check) });
			await harness.ready();
			expect(
				await call(harness, `rev-bad-${String(index)}`, 'CertificateSigned', {
					certificateChain: CERT,
				}),
			).toEqual({ status: 'Rejected' });
			expect(harness.simulator.state.security.signedChains).toEqual({});
			expect(
				harness.simulator.state.security.events.some(
					(event) => event.type === 'InvalidChargingStationCertificate',
				),
			).toBe(true);
			expect(
				harness
					.calls('SecurityEventNotification')
					.map((frame) => (frame[3] as Record<string, unknown>)['type']),
			).toContain('InvalidChargingStationCertificate');
			harness.simulator.dispose();
		}
	});

	it('allows unknown only when configured and rejects malformed results anyway', async () => {
		const allowed = createHarness201({
			security: realSecurity(() => Promise.resolve({ status: 'unknown' }), true),
		});
		await allowed.ready();
		expect(
			await call(allowed, 'rev-unknown-ok', 'CertificateSigned', { certificateChain: CERT }),
		).toEqual({ status: 'Accepted' });
		allowed.simulator.dispose();

		const malformed = createHarness201({
			security: realSecurity(() => Promise.resolve(null as never), true),
		});
		await malformed.ready();
		expect(
			await call(malformed, 'rev-malformed', 'CertificateSigned', { certificateChain: CERT }),
		).toEqual({ status: 'Rejected' });
		malformed.simulator.dispose();

		const revoked = createHarness201({
			security: realSecurity(() => Promise.resolve({ status: 'revoked' }), true),
		});
		await revoked.ready();
		expect(
			await call(revoked, 'rev-revoked-allowed', 'CertificateSigned', {
				certificateChain: CERT,
			}),
		).toEqual({ status: 'Rejected' });
		expect(revoked.simulator.state.security.signedChains).toEqual({});
		revoked.simulator.dispose();
	});

	it('rejects a validator that exceeds the callback timeout', async () => {
		const harness = createHarness201({
			security: {
				mode: 'real',
				callbackTimeoutMs: 10,
				validateCertificateChain: () => new Promise(() => undefined),
			},
		});
		await harness.ready();
		harness.incoming('rev-timeout', 'CertificateSigned', { certificateChain: CERT });
		await harness.ready();
		harness.clock.advance(10);
		await harness.ready();
		expect(framePayload(harness.reply('rev-timeout'))).toEqual({ status: 'Rejected' });
		expect(harness.simulator.state.security.signedChains).toEqual({});
	});

	it('rejects a revocation check that exceeds the callback timeout', async () => {
		const harness = createHarness201({
			security: {
				mode: 'real',
				callbackTimeoutMs: 10,
				validateCertificateChain: () =>
					Promise.resolve({ valid: true, errors: [], hashData: hashData('04') }),
				revocation: { check: () => new Promise(() => undefined) },
			},
		});
		await harness.ready();
		harness.incoming('rev-check-timeout', 'CertificateSigned', { certificateChain: CERT });
		await harness.ready();
		harness.clock.advance(10);
		await harness.ready();
		expect(framePayload(harness.reply('rev-check-timeout'))).toEqual({ status: 'Rejected' });
		expect(harness.simulator.state.security.signedChains).toEqual({});
	});

	it('stores a signed chain for both uses when the type is omitted', async () => {
		let purpose: string | undefined;
		const harness = createHarness201({
			security: {
				mode: 'real',
				validateCertificateChain: (_chain, nextPurpose) => {
					purpose = nextPurpose;
					return Promise.resolve({ valid: true, errors: [], hashData: hashData('02') });
				},
			},
		});
		await harness.ready();
		expect(
			await call(harness, 'rev-both', 'CertificateSigned', { certificateChain: CERT }),
		).toEqual({ status: 'Accepted' });
		expect(purpose).toBe('Both');
		expect(harness.simulator.state.security.signedChains).toEqual({
			ChargingStationCertificate: CERT,
			V2GCertificate: CERT,
		});
	});

	it('stores only the requested ChargingStationCertificate chain', async () => {
		const harness = createHarness201({
			security: {
				mode: 'real',
				validateCertificateChain: () =>
					Promise.resolve({ valid: true, errors: [], hashData: hashData('05') }),
			},
		});
		await harness.ready();
		expect(
			await call(harness, 'rev-cs', 'CertificateSigned', {
				certificateChain: CERT,
				certificateType: 'ChargingStationCertificate',
			}),
		).toEqual({ status: 'Accepted' });
		expect(harness.simulator.state.security.signedChains).toEqual({
			ChargingStationCertificate: CERT,
		});
	});
});

describe('Simulator201 CSR provider', () => {
	it('creates a CSR, forwards the type, and returns the key reference', async () => {
		const create = vi.fn(() => Promise.resolve({ csrPem: CSR, keyRef: 'key-1' }));
		const harness = createHarness201({ security: { csrProvider: { create } } });
		await harness.ready();
		const result = await harness.simulator.certificates.signWithProvider({
			subject: 'CN=CP001',
			keyRef: 'key-0',
			certificateType: 'V2GCertificate',
		});
		expect(result).toEqual({ keyRef: 'key-1', response: { status: 'Accepted' } });
		expect(create).toHaveBeenCalledWith({
			subject: 'CN=CP001',
			keyRef: 'key-0',
			certificateType: 'V2GCertificate',
		});
		expect(harness.calls('SignCertificate')[0]![3]).toEqual({
			csr: CSR,
			certificateType: 'V2GCertificate',
		});
	});

	it('rejects missing providers, invalid results and private keys', async () => {
		const harness = createHarness201();
		await harness.ready();
		await expect(
			harness.simulator.certificates.signWithProvider({ subject: 'CN=x', keyRef: 'k' }),
		).rejects.toThrow('CSR provider is not configured');

		const bad = createHarness201({
			security: {
				csrProvider: {
					create: () =>
						Promise.resolve({
							csrPem: '-----BEGIN PRIVATE KEY-----secret-----END PRIVATE KEY-----',
							keyRef: 'k',
						}),
				},
			},
		});
		await bad.ready();
		await expect(
			bad.simulator.certificates.signWithProvider({ subject: 'CN=x', keyRef: 'k' }),
		).rejects.toThrow('invalid result');
		expect(bad.calls('SignCertificate')).toHaveLength(0);

		const missingKey = createHarness201({
			security: {
				csrProvider: {
					create: () => Promise.resolve({ csrPem: CSR, keyRef: '' }),
				},
			},
		});
		await missingKey.ready();
		await expect(
			missingKey.simulator.certificates.signWithProvider({ subject: 'CN=x', keyRef: 'k' }),
		).rejects.toThrow('invalid result');
		expect(missingKey.calls('SignCertificate')).toHaveLength(0);
	});

	it('maps provider failures and timeouts to clear errors', async () => {
		const failing = createHarness201({
			security: {
				csrProvider: { create: () => Promise.reject(new Error('provider failed')) },
			},
		});
		await failing.ready();
		await expect(
			failing.simulator.certificates.signWithProvider({ subject: 'CN=x', keyRef: 'k' }),
		).rejects.toThrow('CSR provider failed');

		const hanging = createHarness201({
			security: {
				callbackTimeoutMs: 10,
				csrProvider: { create: () => new Promise(() => undefined) },
			},
		});
		await hanging.ready();
		const pending = hanging.simulator.certificates.signWithProvider({
			subject: 'CN=x',
			keyRef: 'k',
		});
		hanging.clock.advance(10);
		await expect(pending).rejects.toThrow('timed out');
	});

	it('rejects malformed raw csr values before sending or storing them', async () => {
		const harness = createHarness201();
		await harness.ready();
		for (const csr of [
			'csr',
			'-----BEGIN PRIVATE KEY-----secret-----END PRIVATE KEY-----',
			'-----BEGIN -----BEGIN RSA PRIVATE KEY-----secret-----END RSA PRIVATE KEY-----',
			'-----begin rsa private key-----secret-----end rsa private key-----',
			`${CSR}\n${CSR}`,
			'-----BEGIN CERTIFICATE REQUEST----------END CERTIFICATE REQUEST-----',
			`${CSR}${' '.repeat(6000)}`,
		]) {
			await expect(harness.simulator.sendSignCertificate(csr)).rejects.toThrow('csr must be');
		}
		await expect(harness.simulator.sendSignCertificate(CSR, 'Bogus' as never)).rejects.toThrow(
			'certificateType',
		);
		expect(harness.calls('SignCertificate')).toHaveLength(0);
		expect(JSON.stringify(harness.simulator.getHistory())).not.toContain('PRIVATE KEY');
	});

	it('accepts the legacy NEW CERTIFICATE REQUEST envelope', async () => {
		const harness = createHarness201();
		await harness.ready();
		const legacy =
			'-----BEGIN NEW CERTIFICATE REQUEST-----\nMIIB\n-----END NEW CERTIFICATE REQUEST-----';
		await expect(harness.simulator.sendSignCertificate(legacy)).resolves.toMatchObject({
			status: 'Accepted',
		});
	});

	it('enforces the CSR maximum length on the original string', async () => {
		const harness = createHarness201();
		await harness.ready();
		const prefix = '-----BEGIN CERTIFICATE REQUEST-----\n';
		const suffix = '\n-----END CERTIFICATE REQUEST-----';
		const exact = `${prefix}${'A'.repeat(5500 - prefix.length - suffix.length)}${suffix}`;
		expect(exact).toHaveLength(5500);
		await expect(harness.simulator.sendSignCertificate(exact)).resolves.toMatchObject({
			status: 'Accepted',
		});
		await expect(harness.simulator.sendSignCertificate(`${exact} `)).rejects.toThrow('csr must be');
	});

	it('validates provider inputs before invoking the provider', async () => {
		const create = vi.fn(() => Promise.resolve({ csrPem: CSR, keyRef: 'k' }));
		const harness = createHarness201({ security: { csrProvider: { create } } });
		await harness.ready();
		await expect(
			harness.simulator.certificates.signWithProvider({
				subject: '',
				keyRef: 'k',
			}),
		).rejects.toThrow('subject and keyRef');
		await expect(
			harness.simulator.certificates.signWithProvider({
				subject: 'CN=x',
				keyRef: '',
			}),
		).rejects.toThrow('subject and keyRef');
		await expect(
			harness.simulator.certificates.signWithProvider({
				subject: 'CN=x',
				keyRef: 'k',
				certificateType: 'Bogus' as never,
			}),
		).rejects.toThrow('certificateType');
		expect(create).not.toHaveBeenCalled();
	});

	it('validates security option combinations', () => {
		expect(() =>
			createHarness201({
				security: {
					mode: 'real',
					validateCertificateChain: () => Promise.resolve({ valid: true, errors: [] }),
					allowUnknownRevocation: true,
				},
			}),
		).toThrow('allowUnknownRevocation');
		expect(() =>
			createHarness201({
				security: {
					mode: 'real',
					validateCertificateChain: () => Promise.resolve({ valid: true, errors: [] }),
					revocation: { check: () => Promise.resolve({ status: 'good' }) },
					callbackTimeoutMs: 0,
				},
			}),
		).toThrow('callbackTimeoutMs');
		expect(() =>
			createHarness201({
				security: {
					revocation: { check: () => Promise.resolve({ status: 'good' }) },
				},
			}),
		).toThrow('Revocation checking requires validateCertificateChain');
		expect(() =>
			createHarness201({
				security: { trustStore: { roots: {} } },
			}),
		).toThrow('trustStore requires validateCertificateChain');
	});
});
