// SPDX-License-Identifier: Apache-2.0
// SPDX-FileCopyrightText: 2026 Rodolfo Carrillo

import { describe, expect, it, vi } from 'vitest';

import { createHarness201, framePayload, type Harness201 } from './helpers/simulator-201.js';
import { flushMicrotasks } from './helpers/fake-clock.js';

const CERT = '-----BEGIN CERTIFICATE-----firmware-----END CERTIFICATE-----';

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

function updatePayload(
	overrides: Record<string, unknown> = {},
	requestId = 1,
): Record<string, unknown> {
	return {
		requestId,
		firmware: {
			location: 'https://example.com/fw.bin',
			retrieveDateTime: '2020-01-01T00:00:00Z',
			signature: 'c2lnbmF0dXJl',
			signingCertificate: CERT,
			...overrides,
		},
	};
}

function statuses(harness: Harness201): string[] {
	return harness
		.calls('FirmwareStatusNotification')
		.map((frame) => String((frame[3] as Record<string, unknown>)['status']));
}

describe('Simulator201 firmware verification', () => {
	it('rejects invalid or revoked signing certificates at request time', async () => {
		const invalid = createHarness201({
			security: {
				mode: 'real',
				validateCertificateChain: () => Promise.resolve({ valid: false, errors: ['bad cert'] }),
				firmwareVerifier: {
					verify: () => Promise.resolve({ valid: true, errors: [] }),
				},
			},
		});
		await invalid.ready();
		expect(await call(invalid, 'fw-invalid-cert', 'UpdateFirmware', updatePayload())).toEqual({
			status: 'InvalidCertificate',
		});
		expect(
			invalid
				.calls('SecurityEventNotification')
				.map((frame) => (frame[3] as Record<string, unknown>)['type']),
		).toContain('InvalidFirmwareSigningCertificate');
		expect(invalid.simulator.state.services.firmware.status).toBeUndefined();

		const revoked = createHarness201({
			security: {
				mode: 'real',
				validateCertificateChain: () =>
					Promise.resolve({ valid: true, errors: [], hashData: undefined }),
				revocation: { check: () => Promise.resolve({ status: 'revoked' }) },
				firmwareVerifier: {
					verify: () => Promise.resolve({ valid: true, errors: [] }),
				},
			},
		});
		await revoked.ready();
		expect(await call(revoked, 'fw-revoked-cert', 'UpdateFirmware', updatePayload())).toEqual({
			status: 'RevokedCertificate',
		});
		expect(
			revoked
				.calls('SecurityEventNotification')
				.map((frame) => (frame[3] as Record<string, unknown>)['type']),
		).toContain('InvalidFirmwareSigningCertificate');

		const unknown = createHarness201({
			security: {
				revocation: { check: () => Promise.resolve({ status: 'unknown' }) },
				firmwareVerifier: {
					verify: () => Promise.resolve({ valid: true, errors: [] }),
				},
			},
		});
		await unknown.ready();
		expect(await call(unknown, 'fw-unknown-cert', 'UpdateFirmware', updatePayload())).toEqual({
			status: 'InvalidCertificate',
		});
	});

	it('runs revocation with a verifier even without a certificate validator', async () => {
		const check = vi.fn((_input: unknown) => Promise.resolve({ status: 'good' as const }));
		const harness = createHarness201({
			security: {
				revocation: { check },
				firmwareVerifier: { verify: () => Promise.resolve({ valid: true, errors: [] }) },
			},
		});
		await harness.ready();
		expect(await call(harness, 'fw-revocation-only', 'UpdateFirmware', updatePayload())).toEqual({
			status: 'Accepted',
		});
		const input = check.mock.calls[0]?.[0] as Record<string, unknown> | undefined;
		expect(input).toMatchObject({ chain: [CERT], purpose: 'ManufacturerRootCertificate' });
		expect(typeof input?.['now']).toBe('number');
	});

	it('keeps an active update when a later request is rejected', async () => {
		const harness = createHarness201({
			security: {
				validateCertificateChain: (chain) =>
					chain[0] === CERT
						? Promise.resolve({ valid: true, errors: [] })
						: Promise.resolve({ valid: false, errors: [] }),
				firmwareVerifier: { verify: () => Promise.resolve({ valid: true, errors: [] }) },
			},
		});
		await harness.ready();
		expect(await call(harness, 'fw-active', 'UpdateFirmware', updatePayload())).toEqual({
			status: 'Accepted',
		});
		expect(
			await call(
				harness,
				'fw-later-invalid',
				'UpdateFirmware',
				updatePayload(
					{
						signingCertificate: '-----BEGIN CERTIFICATE-----other-----END CERTIFICATE-----',
					},
					2,
				),
			),
		).toEqual({ status: 'InvalidCertificate' });
		harness.clock.advance(10);
		await flushMicrotasks(40);
		harness.clock.advance(600);
		await flushMicrotasks(40);
		harness.clock.advance(600);
		await flushMicrotasks(40);
		expect(statuses(harness).at(-1)).toBe('Installed');
	});

	it('rejects duplicate request ids and invalid metadata', async () => {
		const harness = createHarness201({
			security: {
				firmwareVerifier: { verify: () => Promise.resolve({ valid: true, errors: [] }) },
			},
		});
		await harness.ready();
		expect(await call(harness, 'fw-first', 'UpdateFirmware', updatePayload())).toEqual({
			status: 'Accepted',
		});
		expect(await call(harness, 'fw-duplicate', 'UpdateFirmware', updatePayload())).toEqual({
			status: 'Rejected',
			statusInfo: { reasonCode: 'DuplicateRequestId' },
		});
		expect(
			(
				await errorCall(
					harness,
					'fw-location-key',
					'UpdateFirmware',
					updatePayload(
						{
							location: '-----BEGIN PRIVATE KEY-----secret-----END PRIVATE KEY-----',
						},
						2,
					),
				)
			).slice(0, 3),
		).toEqual([4, 'fw-location-key', 'FormatViolation']);
		expect(
			(
				await errorCall(
					harness,
					'fw-bad-install',
					'UpdateFirmware',
					updatePayload({ installDateTime: 'not-a-date' }, 3),
				)
			).slice(0, 3),
		).toEqual([4, 'fw-bad-install', 'FormatViolation']);
	});

	it('normalizes an in-flight firmware update after restore', async () => {
		const harness = createHarness201({
			security: {
				firmwareVerifier: { verify: () => Promise.resolve({ valid: true, errors: [] }) },
			},
		});
		await harness.ready();
		await call(harness, 'fw-restore', 'UpdateFirmware', updatePayload());
		const snapshot = harness.simulator.exportSnapshot();
		expect(harness.simulator.restoreSnapshot(snapshot)).toEqual({ restored: true });
		expect(harness.simulator.state.services.firmware.status).toBe('Idle');
		expect(harness.simulator.state.services.firmware.update).toBeUndefined();
	});

	it('requires a verifier in real mode and signature fields when verifying', async () => {
		const real = createHarness201({
			security: {
				mode: 'real',
				validateCertificateChain: () =>
					Promise.resolve({ valid: true, errors: [], hashData: undefined }),
			},
		});
		await real.ready();
		expect(await call(real, 'fw-no-verifier', 'UpdateFirmware', updatePayload())).toEqual({
			status: 'Rejected',
		});

		const missing = createHarness201({
			security: {
				firmwareVerifier: { verify: () => Promise.resolve({ valid: true, errors: [] }) },
			},
		});
		await missing.ready();
		expect(
			await call(
				missing,
				'fw-no-signature',
				'UpdateFirmware',
				updatePayload({ signature: undefined }),
			),
		).toEqual({ status: 'Rejected' });
		expect(
			await call(
				missing,
				'fw-no-cert',
				'UpdateFirmware',
				updatePayload({ signingCertificate: undefined }),
			),
		).toEqual({ status: 'InvalidCertificate' });
	});

	it('verifies the downloaded image and reports SignatureVerified', async () => {
		const verify = vi.fn((_input: unknown) => Promise.resolve({ valid: true, errors: [] }));
		const harness = createHarness201({ security: { firmwareVerifier: { verify } } });
		await harness.ready();
		expect(await call(harness, 'fw-valid', 'UpdateFirmware', updatePayload())).toEqual({
			status: 'Accepted',
		});
		harness.clock.advance(10);
		await flushMicrotasks(40);
		harness.clock.advance(600);
		await flushMicrotasks(40);
		harness.clock.advance(600);
		await flushMicrotasks(40);
		expect(statuses(harness)).toEqual([
			'Downloading',
			'Downloaded',
			'SignatureVerified',
			'InstallScheduled',
			'Installing',
			'Installed',
		]);
		const input = verify.mock.calls[0]?.[0] as Record<string, unknown> | undefined;
		expect(input).toMatchObject({
			signature: 'c2lnbmF0dXJl',
			signingCertificate: CERT,
		});
		expect(input?.['firmware']).toMatchObject({ location: 'https://example.com/fw.bin' });
		expect(typeof input?.['now']).toBe('number');
		expect(harness.simulator.state.services.firmware.update).toBeUndefined();
		await call(harness, 'fw-trigger', 'TriggerMessage', {
			requestedMessage: 'FirmwareStatusNotification',
		});
		expect(
			harness
				.calls('FirmwareStatusNotification')
				.map((frame) => frame[3] as Record<string, unknown>)
				.at(-1),
		).toEqual({ status: 'Idle' });
	});

	it('reports invalid signatures and certificate failures after download', async () => {
		const invalidSignature = createHarness201({
			security: {
				firmwareVerifier: {
					verify: () =>
						Promise.resolve({ valid: false, reason: 'invalid-signature', errors: ['bad'] }),
				},
			},
		});
		await invalidSignature.ready();
		await call(invalidSignature, 'fw-bad-signature', 'UpdateFirmware', updatePayload());
		invalidSignature.clock.advance(10);
		await flushMicrotasks(40);
		expect(statuses(invalidSignature)).toEqual(['Downloading', 'Downloaded', 'InvalidSignature']);
		expect(
			invalidSignature
				.calls('SecurityEventNotification')
				.map((frame) => (frame[3] as Record<string, unknown>)['type']),
		).toContain('InvalidFirmwareSignature');

		const invalidCertificate = createHarness201({
			security: {
				firmwareVerifier: {
					verify: () =>
						Promise.resolve({ valid: false, reason: 'invalid-certificate', errors: [] }),
				},
			},
		});
		await invalidCertificate.ready();
		await call(invalidCertificate, 'fw-bad-cert', 'UpdateFirmware', updatePayload());
		invalidCertificate.clock.advance(10);
		await flushMicrotasks(40);
		expect(statuses(invalidCertificate)).toEqual([
			'Downloading',
			'Downloaded',
			'InstallVerificationFailed',
		]);
		expect(
			invalidCertificate
				.calls('SecurityEventNotification')
				.map((frame) => (frame[3] as Record<string, unknown>)['type']),
		).toContain('InvalidFirmwareSigningCertificate');
	});

	it('sanitizes firmware update metadata in snapshots', async () => {
		const harness = createHarness201({
			security: {
				firmwareVerifier: { verify: () => Promise.resolve({ valid: true, errors: [] }) },
			},
		});
		await harness.ready();
		await call(harness, 'fw-snapshot', 'UpdateFirmware', updatePayload());
		interface SnapshotShape {
			state: { services: { firmware: { update?: Record<string, unknown> } } };
		}
		const valid = harness.simulator.exportSnapshot() as unknown as SnapshotShape;
		expect(harness.simulator.restoreSnapshot(valid)).toEqual({ restored: true });

		const hostile = harness.simulator.exportSnapshot() as unknown as SnapshotShape;
		hostile.state.services.firmware.update = {
			location: 'https://example.com/fw.bin',
			retrieveDateTime: '2020-01-01T00:00:00Z',
			signature: 'sig',
			signingCertificate: '-----BEGIN PRIVATE KEY-----secret-----END PRIVATE KEY-----',
		};
		expect(harness.simulator.restoreSnapshot(hostile)).toMatchObject({ restored: false });
	});

	it('fails closed when the verifier throws or times out', async () => {
		const throwing = createHarness201({
			security: {
				firmwareVerifier: { verify: () => Promise.reject(new Error('verifier failed')) },
			},
		});
		await throwing.ready();
		await call(throwing, 'fw-throw', 'UpdateFirmware', updatePayload());
		throwing.clock.advance(10);
		await flushMicrotasks(40);
		expect(statuses(throwing).at(-1)).toBe('InstallVerificationFailed');

		const timeout = createHarness201({
			security: {
				callbackTimeoutMs: 10,
				firmwareVerifier: { verify: () => new Promise(() => undefined) },
			},
		});
		await timeout.ready();
		await call(timeout, 'fw-timeout', 'UpdateFirmware', updatePayload());
		timeout.clock.advance(10);
		await flushMicrotasks(40);
		timeout.clock.advance(10);
		await flushMicrotasks(40);
		expect(statuses(timeout).at(-1)).toBe('InstallVerificationFailed');
	});
});
