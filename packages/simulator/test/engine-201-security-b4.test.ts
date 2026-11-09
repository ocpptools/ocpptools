// SPDX-License-Identifier: Apache-2.0
// SPDX-FileCopyrightText: 2026 Rodolfo Carrillo

import { describe, expect, it, vi } from 'vitest';

import type { Iso15118Codec201 } from '../src/2.0.1.js';
import { createHarness201 } from './helpers/simulator-201.js';

const PAYLOAD = { certificateInstallationReq: 'contract' };

function codec(overrides: Partial<Iso15118Codec201> = {}): Iso15118Codec201 {
	return {
		encodeRequest: vi.fn(() => Promise.resolve('exi-request')),
		decodeResponse: vi.fn(() => Promise.resolve({ decoded: true })),
		...overrides,
	};
}

describe('Simulator201 ISO 15118 codec', () => {
	it('encodes, sends, decodes and validates a message', async () => {
		const encodeRequest = vi.fn(() => Promise.resolve('exi-request'));
		const decodeResponse = vi.fn(() => Promise.resolve({ decoded: true }));
		const validateResponse = vi.fn(() => Promise.resolve({ valid: true, errors: [] }));
		const harness = createHarness201({
			security: { iso15118: { encodeRequest, decodeResponse, validateResponse } },
		});
		await harness.ready();
		await expect(
			harness.simulator.certificates.get15118Message('iso2', 'Install', PAYLOAD),
		).resolves.toEqual({ decoded: true });
		expect(encodeRequest).toHaveBeenCalledWith({
			schemaVersion: 'iso2',
			action: 'Install',
			payload: PAYLOAD,
		});
		expect(decodeResponse).toHaveBeenCalledWith({
			schemaVersion: 'iso2',
			action: 'Install',
			exiResponse: 'exi-response',
		});
		expect(validateResponse).toHaveBeenCalledWith({
			schemaVersion: 'iso2',
			action: 'Install',
			response: { decoded: true },
		});
		expect(harness.calls('Get15118EVCertificate')[0]![3]).toEqual({
			iso15118SchemaVersion: 'iso2',
			action: 'Install',
			exiRequest: 'exi-request',
		});
	});

	it('works without a response validator and for Update', async () => {
		const harness = createHarness201({ security: { iso15118: codec() } });
		await harness.ready();
		await expect(
			harness.simulator.certificates.get15118Message('iso2', 'Update', PAYLOAD),
		).resolves.toEqual({ decoded: true });
	});

	it('rejects a missing codec and invalid raw requests', async () => {
		const harness = createHarness201();
		await harness.ready();
		await expect(
			harness.simulator.certificates.get15118Message('iso2', 'Install', PAYLOAD),
		).rejects.toThrow('ISO 15118 codec is not configured');
		await expect(
			harness.simulator.sendGet15118EVCertificate('iso2', 'Install', ''),
		).rejects.toThrow('exiRequest');
		await expect(
			harness.simulator.sendGet15118EVCertificate(
				'iso2',
				'Install',
				'-----BEGIN PRIVATE KEY-----secret-----END PRIVATE KEY-----',
			),
		).rejects.toThrow('exiRequest');
		await expect(
			harness.simulator.sendGet15118EVCertificate('iso2', 'Install', 'x'.repeat(5601)),
		).rejects.toThrow('exiRequest');
		await expect(
			harness.simulator.sendGet15118EVCertificate('x'.repeat(51), 'Install', 'request'),
		).rejects.toThrow('exiRequest');
		await expect(
			harness.simulator.sendGet15118EVCertificate('iso2', 'Install', 'x'.repeat(5600)),
		).resolves.toMatchObject({ status: 'Accepted' });
		expect(harness.calls('Get15118EVCertificate')).toHaveLength(1);
	});

	it('rejects a failed response and reports its reason', async () => {
		const harness = createHarness201({
			security: { iso15118: codec() },
			responses: {
				Get15118EVCertificate: {
					status: 'Failed',
					statusInfo: { reasonCode: 'FAILED' },
				},
			},
		});
		await harness.ready();
		await expect(
			harness.simulator.certificates.get15118Message('iso2', 'Install', PAYLOAD),
		).rejects.toThrow('failed: FAILED');

		const noReason = createHarness201({
			security: { iso15118: codec() },
			responses: { Get15118EVCertificate: { status: 'Failed' } },
		});
		await noReason.ready();
		await expect(
			noReason.simulator.certificates.get15118Message('iso2', 'Install', PAYLOAD),
		).rejects.toThrow('failed: not accepted');
	});

	it('rejects empty, missing, long or private-key exi responses', async () => {
		for (const exiResponse of [
			undefined,
			'',
			'x'.repeat(5601),
			'-----BEGIN PRIVATE KEY-----k-----END PRIVATE KEY-----',
		]) {
			const harness = createHarness201({
				security: { iso15118: codec() },
				responses: {
					Get15118EVCertificate: {
						status: 'Accepted',
						...(exiResponse === undefined ? {} : { exiResponse }),
					},
				},
			});
			await harness.ready();
			await expect(
				harness.simulator.certificates.get15118Message('iso2', 'Install', PAYLOAD),
			).rejects.toThrow('invalid exiResponse');
			harness.simulator.dispose();
		}
	});

	it('maps encoder, decoder and validator failures', async () => {
		const encoder = createHarness201({
			security: {
				iso15118: codec({
					encodeRequest: () => Promise.reject(new Error('encoder failed')),
				}),
			},
		});
		await encoder.ready();
		await expect(
			encoder.simulator.certificates.get15118Message('iso2', 'Install', PAYLOAD),
		).rejects.toThrow('ISO 15118 encoder failed');

		const invalidRequest = createHarness201({
			security: { iso15118: codec({ encodeRequest: () => Promise.resolve('') }) },
		});
		await invalidRequest.ready();
		await expect(
			invalidRequest.simulator.certificates.get15118Message('iso2', 'Install', PAYLOAD),
		).rejects.toThrow('invalid request');

		const privateRequest = createHarness201({
			security: {
				iso15118: codec({
					encodeRequest: () =>
						Promise.resolve('-----BEGIN PRIVATE KEY-----k-----END PRIVATE KEY-----'),
				}),
			},
		});
		await privateRequest.ready();
		await expect(
			privateRequest.simulator.certificates.get15118Message('iso2', 'Install', PAYLOAD),
		).rejects.toThrow('invalid request');

		const decoder = createHarness201({
			security: {
				iso15118: codec({
					decodeResponse: () => Promise.reject(new Error('decoder failed')),
				}),
			},
		});
		await decoder.ready();
		await expect(
			decoder.simulator.certificates.get15118Message('iso2', 'Install', PAYLOAD),
		).rejects.toThrow('ISO 15118 decoder failed');

		const validator = createHarness201({
			security: {
				iso15118: codec({
					validateResponse: () => Promise.resolve({ valid: false, errors: ['bad contract'] }),
				}),
			},
		});
		await validator.ready();
		await expect(
			validator.simulator.certificates.get15118Message('iso2', 'Install', PAYLOAD),
		).rejects.toThrow('bad contract');

		const validatorThrow = createHarness201({
			security: {
				iso15118: codec({
					validateResponse: () => Promise.reject(new Error('validator failed')),
				}),
			},
		});
		await validatorThrow.ready();
		await expect(
			validatorThrow.simulator.certificates.get15118Message('iso2', 'Install', PAYLOAD),
		).rejects.toThrow('ISO 15118 validator failed');
	});

	it('times out a codec that does not settle', async () => {
		const harness = createHarness201({
			security: {
				callbackTimeoutMs: 10,
				iso15118: codec({ encodeRequest: () => new Promise(() => undefined) }),
			},
		});
		await harness.ready();
		const pending = harness.simulator.certificates.get15118Message('iso2', 'Install', PAYLOAD);
		harness.clock.advance(10);
		await expect(pending).rejects.toThrow('timed out');
	});
});
