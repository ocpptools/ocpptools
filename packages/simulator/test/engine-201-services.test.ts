// SPDX-License-Identifier: Apache-2.0
// SPDX-FileCopyrightText: 2026 Rodolfo Carrillo

import { describe, expect, it } from 'vitest';

import type { JsonObject } from '@ocpptools/core';

import { createHarness201, framePayload, type Harness201 } from './helpers/simulator-201.js';
import { flushMicrotasks } from './helpers/fake-clock.js';

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

function displayMessage(overrides: Record<string, unknown> = {}): Record<string, unknown> {
	return {
		id: 1,
		priority: 'NormalCycle',
		state: 'Idle',
		message: { format: 'UTF8', content: 'Welcome' },
		...overrides,
	};
}

describe('Simulator201 services', () => {
	it('stores, reports, and clears display messages', async () => {
		const harness = createHarness201();
		await harness.ready();
		expect(
			await call(harness, 'disp-1', 'SetDisplayMessage', { message: displayMessage() }),
		).toEqual({ status: 'Accepted' });
		expect(harness.simulator.state.services.displays).toHaveLength(1);
		await call(harness, 'disp-2', 'SetDisplayMessage', {
			message: displayMessage({ message: { format: 'ASCII', content: 'Updated' } }),
		});
		expect(harness.simulator.state.services.displays).toHaveLength(1);
		expect(
			(harness.simulator.state.services.displays[0]?.message['message'] as JsonObject)['content'],
		).toBe('Updated');
		expect(
			await call(harness, 'disp-3', 'GetDisplayMessages', {
				requestId: 1,
				id: [1],
				priority: 'NormalCycle',
				state: 'Idle',
			}),
		).toEqual({ status: 'Accepted' });
		const notify = harness.calls('NotifyDisplayMessages')[0]![3] as Record<string, unknown>;
		expect(notify).toMatchObject({ requestId: 1, tbc: false });
		expect((notify['messageInfo'] as unknown[]).length).toBe(1);
		expect(await call(harness, 'disp-4', 'GetDisplayMessages', { requestId: 2, id: [99] })).toEqual(
			{
				status: 'Unknown',
			},
		);
		expect(await call(harness, 'disp-5', 'ClearDisplayMessage', { id: 1 })).toEqual({
			status: 'Accepted',
		});
		expect(await call(harness, 'disp-6', 'ClearDisplayMessage', { id: 1 })).toEqual({
			status: 'Unknown',
		});
		expect(
			(
				await errorCall(harness, 'disp-7', 'SetDisplayMessage', {
					message: { id: 1, priority: 'Bogus' },
				})
			).slice(0, 3),
		).toEqual([4, 'disp-7', 'FormatViolation']);
		expect(
			(
				await errorCall(harness, 'disp-8', 'GetDisplayMessages', {
					requestId: 1,
					priority: 'Bogus',
				})
			).slice(0, 3),
		).toEqual([4, 'disp-8', 'FormatViolation']);
	});

	it('checks transaction-scoped display messages', async () => {
		const harness = createHarness201();
		await harness.ready();
		expect(
			await call(harness, 'disp-tx-1', 'SetDisplayMessage', {
				message: displayMessage({ transactionId: 'missing' }),
			}),
		).toEqual({ status: 'UnknownTransaction' });
		const started = await harness.simulator.startChargingSession(1, 'A');
		expect(
			await call(harness, 'disp-tx-2', 'SetDisplayMessage', {
				message: displayMessage({ transactionId: started.transactionId }),
			}),
		).toEqual({ status: 'Accepted' });
		await harness.simulator.stopTransaction(1);
		expect(
			await call(harness, 'disp-tx-3', 'GetDisplayMessages', { requestId: 3, id: [1] }),
		).toEqual({ status: 'Unknown' });
	});

	it('stores cost updates and rejects malformed requests', async () => {
		const harness = createHarness201();
		await harness.ready();
		expect(
			await call(harness, 'cost-1', 'CostUpdated', { totalCost: 12.5, transactionId: 'T-1' }),
		).toEqual({});
		expect(harness.simulator.state.services.cost).toEqual({
			totalCost: 12.5,
			transactionId: 'T-1',
		});
		expect(
			(
				await errorCall(harness, 'cost-2', 'CostUpdated', {
					totalCost: 'free',
					transactionId: 'T-1',
				})
			).slice(0, 3),
		).toEqual([4, 'cost-2', 'FormatViolation']);
	});

	it('reports and clears customer information', async () => {
		const harness = createHarness201();
		await harness.ready();
		expect(
			await call(harness, 'cust-1', 'CustomerInformation', {
				requestId: 5,
				report: true,
				clear: false,
				idToken: { idToken: 'A', type: 'ISO14443' },
			}),
		).toEqual({ status: 'Accepted' });
		const notify = harness.calls('NotifyCustomerInformation')[0]![3] as Record<string, unknown>;
		expect(notify).toMatchObject({ requestId: 5, seqNo: 0, tbc: false });
		expect(typeof notify['data']).toBe('string');
		expect(harness.simulator.state.services.customer.data).toBe(notify['data']);
		expect(
			await call(harness, 'cust-2', 'CustomerInformation', {
				requestId: 6,
				report: false,
				clear: true,
				customerIdentifier: 'C-1',
			}),
		).toEqual({ status: 'Accepted' });
		expect(harness.simulator.state.services.customer.data).toBeUndefined();
		expect(
			await call(harness, 'cust-3', 'CustomerInformation', {
				requestId: 7,
				report: true,
				clear: false,
			}),
		).toEqual({ status: 'Rejected' });
		expect(
			await call(harness, 'cust-cert', 'CustomerInformation', {
				requestId: 8,
				report: false,
				clear: false,
				customerCertificate: {
					hashAlgorithm: 'SHA256',
					issuerNameHash: 'issuer',
					issuerKeyHash: 'key',
					serialNumber: '1',
				},
			}),
		).toEqual({ status: 'Accepted' });
		expect(
			(
				await errorCall(harness, 'cust-4', 'CustomerInformation', {
					requestId: 8,
					report: 'yes',
					clear: false,
				})
			).slice(0, 3),
		).toEqual([4, 'cust-4', 'FormatViolation']);
	});

	it('simulates firmware update and publish flows', async () => {
		const harness = createHarness201();
		await harness.ready();
		expect(
			await call(harness, 'fw-1', 'UpdateFirmware', {
				requestId: 1,
				firmware: {
					location: 'https://example.com/fw.bin',
					retrieveDateTime: '2020-01-01T00:00:00Z',
				},
			}),
		).toEqual({ status: 'Accepted' });
		expect(harness.simulator.state.services.firmware.status).toBe('Downloading');
		harness.clock.advance(1500);
		await flushMicrotasks(40);
		expect(harness.simulator.state.services.firmware.status).toBe('Installed');
		const statuses = harness
			.calls('FirmwareStatusNotification')
			.map((frame) => (frame[3] as Record<string, unknown>)['status']);
		expect(statuses).toEqual([
			'Downloading',
			'Downloaded',
			'InstallScheduled',
			'Installing',
			'Installed',
		]);
		expect(
			(
				await errorCall(harness, 'fw-2', 'UpdateFirmware', {
					requestId: 1,
					firmware: { location: 'x' },
				})
			).slice(0, 3),
		).toEqual([4, 'fw-2', 'FormatViolation']);

		expect(
			await call(harness, 'pub-1', 'PublishFirmware', {
				location: 'https://example.com/fw.bin',
				checksum: 'abc',
				requestId: 2,
			}),
		).toEqual({ status: 'Accepted' });
		expect(harness.calls('PublishFirmwareStatusNotification')).toHaveLength(1);
		expect(
			(harness.calls('PublishFirmwareStatusNotification')[0]![3] as Record<string, unknown>)[
				'location'
			],
		).toEqual(['https://example.com/fw.bin']);
		await call(harness, 'fw-3', 'UpdateFirmware', {
			requestId: 3,
			firmware: {
				location: 'https://example.com/other.bin',
				retrieveDateTime: '2020-01-01T00:00:00Z',
			},
		});
		expect(await call(harness, 'pub-2', 'UnpublishFirmware', { checksum: 'wrong' })).toEqual({
			status: 'NoFirmware',
		});
		expect(await call(harness, 'pub-3', 'UnpublishFirmware', { checksum: 'abc' })).toEqual({
			status: 'Unpublished',
		});
		expect(
			(await errorCall(harness, 'pub-4', 'UnpublishFirmware', { checksum: 1 })).slice(0, 3),
		).toEqual([4, 'pub-4', 'FormatViolation']);
	});

	it('uploads logs and reports the upload status', async () => {
		const harness = createHarness201();
		await harness.ready();
		expect(
			await call(harness, 'log-1', 'GetLog', {
				requestId: 7,
				logType: 'SecurityLog',
				log: { remoteLocation: 'https://example.com/logs' },
			}),
		).toEqual({ status: 'Accepted', filename: 'log-7.log' });
		expect(harness.simulator.state.services.log.status).toBe('Uploading');
		harness.clock.advance(1000);
		await flushMicrotasks(30);
		expect(harness.simulator.state.services.log.status).toBe('Uploaded');
		expect(
			(
				await errorCall(harness, 'log-2', 'GetLog', {
					requestId: 8,
					logType: 'Nope',
					log: {},
				})
			).slice(0, 3),
		).toEqual([4, 'log-2', 'FormatViolation']);
	});

	it('cancels overlapping firmware and log flows', async () => {
		const harness = createHarness201();
		await harness.ready();
		expect(
			await call(harness, 'ov-fw-1', 'UpdateFirmware', {
				requestId: 1,
				firmware: { location: 'a', retrieveDateTime: '2020-01-01T00:00:00Z' },
			}),
		).toEqual({ status: 'Accepted' });
		expect(
			await call(harness, 'ov-fw-2', 'UpdateFirmware', {
				requestId: 2,
				firmware: { location: 'b', retrieveDateTime: '2020-01-01T00:00:00Z' },
			}),
		).toEqual({ status: 'AcceptedCanceled' });
		harness.clock.advance(2000);
		await flushMicrotasks(40);
		const firmwareNotifications = harness
			.calls('FirmwareStatusNotification')
			.map((frame) => frame[3] as Record<string, unknown>);
		expect(
			firmwareNotifications.filter(
				(payload) => payload['status'] === 'Installed' && payload['requestId'] === 2,
			),
		).toHaveLength(1);
		expect(harness.simulator.state.services.firmware.requestId).toBe(2);

		expect(
			await call(harness, 'ov-log-1', 'GetLog', {
				requestId: 1,
				logType: 'SecurityLog',
				log: { remoteLocation: 'https://x' },
			}),
		).toEqual({ status: 'Accepted', filename: 'log-1.log' });
		expect(
			await call(harness, 'ov-log-2', 'GetLog', {
				requestId: 2,
				logType: 'SecurityLog',
				log: { remoteLocation: 'https://x' },
			}),
		).toMatchObject({ status: 'AcceptedCanceled', filename: 'log-2.log' });
		harness.clock.advance(2000);
		await flushMicrotasks(40);
		expect(
			harness
				.calls('LogStatusNotification')
				.map((frame) => frame[3] as Record<string, unknown>)
				.filter((payload) => payload['status'] === 'Uploaded' && payload['requestId'] === 2),
		).toHaveLength(1);
	});

	it('sends the service notifications through the public API', async () => {
		const harness = createHarness201();
		await harness.ready();
		await harness.simulator.sendFirmwareStatus('Idle', 1);
		await harness.simulator.sendPublishFirmwareStatus('Idle', ['https://x'], 2);
		await harness.simulator.sendLogStatus('Idle', 3);
		await harness.simulator.sendNotifyDisplayMessages(4, [displayMessage() as JsonObject]);
		await harness.simulator.sendNotifyCustomerInformation(5, 'data', 0, false);
		expect(harness.calls('FirmwareStatusNotification')[0]![3]).toMatchObject({
			status: 'Idle',
			requestId: 1,
		});
		expect(harness.calls('PublishFirmwareStatusNotification')[0]![3]).toMatchObject({
			status: 'Idle',
			location: ['https://x'],
		});
		expect(harness.calls('LogStatusNotification')[0]![3]).toMatchObject({
			status: 'Idle',
			requestId: 3,
		});
		expect(harness.calls('NotifyDisplayMessages')[0]![3]).toMatchObject({ requestId: 4 });
		expect(harness.calls('NotifyCustomerInformation')[0]![3]).toMatchObject({
			requestId: 5,
			data: 'data',
		});
	});

	it('uses the reject mode for service commands', async () => {
		const harness = createHarness201();
		await harness.ready();
		harness.simulator.setInboundResponseMode('reject');
		expect(
			await call(harness, 'srej-1', 'SetDisplayMessage', { message: displayMessage() }),
		).toEqual({ status: 'Rejected' });
		expect(await call(harness, 'srej-2', 'ClearDisplayMessage', { id: 1 })).toEqual({
			status: 'Unknown',
		});
		expect(await call(harness, 'srej-3', 'GetDisplayMessages', { requestId: 1 })).toEqual({
			status: 'Unknown',
		});
		expect(
			await call(harness, 'srej-4', 'CustomerInformation', {
				requestId: 1,
				report: true,
				clear: false,
				idToken: { idToken: 'A', type: 'ISO14443' },
			}),
		).toEqual({ status: 'Rejected' });
		expect(
			await call(harness, 'srej-5', 'UpdateFirmware', {
				requestId: 1,
				firmware: { location: 'x', retrieveDateTime: '2030-01-01T00:00:00Z' },
			}),
		).toEqual({ status: 'Rejected' });
		expect(
			await call(harness, 'srej-6', 'PublishFirmware', {
				location: 'x',
				checksum: 'a',
				requestId: 1,
			}),
		).toEqual({ status: 'Rejected' });
		expect(await call(harness, 'srej-7', 'UnpublishFirmware', { checksum: 'a' })).toEqual({
			status: 'NoFirmware',
		});
		expect(
			await call(harness, 'srej-8', 'GetLog', {
				requestId: 1,
				logType: 'SecurityLog',
				log: { remoteLocation: 'x' },
			}),
		).toEqual({ status: 'Rejected' });
	});

	it('queues display reports before boot', async () => {
		const harness = createHarness201({
			bootStatus: 'Pending',
			boot: { auto: true, required: true, retryOnPending: false },
		});
		await harness.ready();
		await call(harness, 'pre-disp-setup', 'SetDisplayMessage', { message: displayMessage() });
		expect(await call(harness, 'pre-disp', 'GetDisplayMessages', { requestId: 1 })).toEqual({
			status: 'Accepted',
		});
		expect(harness.calls('NotifyDisplayMessages')).toHaveLength(0);
		expect(
			harness.simulator.getQueue().some((entry) => entry.action === 'NotifyDisplayMessages'),
		).toBe(true);
	});
});
