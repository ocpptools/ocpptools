// SPDX-License-Identifier: Apache-2.0
// SPDX-FileCopyrightText: 2026 Rodolfo Carrillo

import type { JsonObject } from '@ocpptools/core';
import { describe, expect, it } from 'vitest';

import { createSimulator } from '../src/index.js';
import { Simulator16 } from '../src/1.6.js';
import { Simulator201 } from '../src/2.0.1.js';
import { FakeClock, flushMicrotasks } from './helpers/fake-clock.js';
import { FakeTransportFactory, type FakeTransport } from './helpers/fake-transport.js';

interface CallFrameSent {
	readonly id: string;
	readonly action: string;
	readonly payload: JsonObject;
}

function sentCalls(transport: FakeTransport): CallFrameSent[] {
	return transport.sent
		.map((text) => JSON.parse(text) as unknown[])
		.filter((frame) => frame[0] === 2)
		.map((frame) => ({
			id: String(frame[1]),
			action: String(frame[2]),
			payload: (frame[3] ?? {}) as JsonObject,
		}));
}

function autoRespond(transport: FakeTransport, responses: Record<string, unknown> = {}): void {
	const send = transport.send.bind(transport);
	transport.send = (text: string): void => {
		send(text);
		const frame = JSON.parse(text) as unknown[];
		if (frame[0] !== 2) return;
		const [, id, action] = frame as [number, string, string];
		const defaults: Record<string, unknown> = {
			BootNotification: {
				status: 'Accepted',
				currentTime: '2026-01-01T00:00:00Z',
				interval: 60,
			},
			Authorize: { idTagInfo: { status: 'Accepted' } },
			StartTransaction: { transactionId: 42, idTagInfo: { status: 'Accepted' } },
			StopTransaction: { idTagInfo: { status: 'Accepted' } },
			Heartbeat: { currentTime: '2026-01-01T00:00:00Z' },
			DataTransfer: { status: 'Accepted' },
		};
		transport.receive(JSON.stringify([3, id, responses[action] ?? defaults[action] ?? {}]));
	};
}

async function ready16(responses: Record<string, unknown> = {}) {
	const clock = new FakeClock();
	const factory = new FakeTransportFactory();
	let sequence = 0;
	const simulator = new Simulator16({
		url: 'ws://localhost/CP16',
		transport: factory.factory,
		clock,
		messageIds: () => `id-${++sequence}`,
		station: {
			id: 'CP16',
			vendor: 'Acme',
			model: 'AC-7',
			firmwareVersion: '1.0.0',
			connectorCount: 2,
			defaultIdTag: 'DEFAULT',
		},
	});
	simulator.connect();
	const transport = factory.transports[0]!;
	autoRespond(transport, responses);
	transport.open();
	await flushMicrotasks(60);
	expect(simulator.isReady).toBe(true);
	return { clock, factory, transport, simulator };
}

async function ready201(responses: Record<string, unknown> = {}) {
	const clock = new FakeClock();
	const factory = new FakeTransportFactory();
	let sequence = 0;
	const simulator = new Simulator201({
		url: 'ws://localhost/CP201',
		transport: factory.factory,
		clock,
		messageIds: () => `id-${++sequence}`,
		station: {
			id: 'CP201',
			vendorName: 'Acme',
			model: 'AC-22',
			firmwareVersion: '2.0.0',
		},
	});
	simulator.connect();
	const transport = factory.transports[0]!;
	autoRespond(transport, responses);
	transport.open();
	await flushMicrotasks(60);
	expect(simulator.isReady).toBe(true);
	return { clock, factory, transport, simulator };
}

async function reserve16(
	simulator: Simulator16,
	reservationId: number,
	idTag: string,
): Promise<void> {
	simulator.rpc.handleText(
		JSON.stringify([
			2,
			`reserve-${reservationId}`,
			'ReserveNow',
			{
				connectorId: 1,
				expiryDate: '2030-01-01T00:00:00Z',
				idTag,
				reservationId,
			},
		]),
	);
	await flushMicrotasks(30);
	expect(simulator.getConnector(1)?.status).toBe('Reserved');
	expect(simulator.getConnector(1)?.reservation?.id).toBe(reservationId);
}

describe('simulator API behavior', () => {
	it('restores a reservation when a start session fails', async () => {
		const { simulator } = await ready16({
			Authorize: { idTagInfo: { status: 'Invalid' } },
		});
		await reserve16(simulator, 7, 'TAG');

		const rejected = await simulator.transactions.startSession(1, 'TAG');
		expect(rejected).toEqual({ ok: false, reason: 'authorize-rejected' });
		expect(simulator.getConnector(1)).toMatchObject({
			status: 'Reserved',
			reservation: { id: 7 },
			activeTransaction: null,
		});

		const bypass = await simulator.transactions.start(1, 'OTHER');
		expect(bypass).toEqual({ ok: false, reason: 'reserved' });
		simulator.dispose();
	});

	it('validates meterStart before sending StartTransaction', async () => {
		const { simulator, transport } = await ready16();
		const before = sentCalls(transport).filter((call) => call.action === 'StartTransaction');

		const negative = await simulator.transactions.start(1, 'TAG', -1);
		expect(negative).toEqual({ ok: false, reason: 'invalid-meter-start' });
		const fractional = await simulator.transactions.start(1, 'TAG', 1.5);
		expect(fractional).toEqual({ ok: false, reason: 'invalid-meter-start' });

		const after = sentCalls(transport).filter((call) => call.action === 'StartTransaction');
		expect(after).toHaveLength(before.length);
		expect(simulator.getConnector(1)?.status).toBe('Available');
		simulator.dispose();
	});

	it('starts a reserved transaction with meterStart and sends manual meter values', async () => {
		const { simulator, transport } = await ready16();
		await reserve16(simulator, 9, 'TAG');

		const started = await simulator.transactions.start(1, 'TAG', 500);
		expect(started).toEqual({ ok: true, transactionId: 42 });
		expect(simulator.getConnector(1)).toMatchObject({
			status: 'Charging',
			meterWh: 500,
			reservation: null,
			activeTransaction: { transactionId: 42, meterStart: 500 },
		});
		const startCall = sentCalls(transport).find((call) => call.action === 'StartTransaction');
		expect(startCall?.payload).toMatchObject({
			connectorId: 1,
			idTag: 'TAG',
			meterStart: 500,
			reservationId: 9,
		});

		await simulator.transactions.meter(1);
		const meterCall = sentCalls(transport).find((call) => call.action === 'MeterValues');
		expect(meterCall?.payload).toMatchObject({
			connectorId: 1,
			transactionId: 42,
			meterValue: [
				{
					sampledValue: [
						{
							value: '500',
							context: 'Sample.Periodic',
							format: 'Raw',
							measurand: 'Energy.Active.Import.Register',
							unit: 'Wh',
						},
					],
				},
			],
		});
		expect(simulator.getConnector(1)?.meterWh).toBe(500);
		simulator.dispose();
	});

	it('uses the station default idTag for the free helpers', async () => {
		const { simulator, transport } = await ready16();
		const result = await simulator.startTransaction(1);
		expect(result.ok).toBe(true);
		const startCall = sentCalls(transport).find((call) => call.action === 'StartTransaction');
		expect(startCall?.payload['idTag']).toBe('DEFAULT');
		simulator.dispose();
	});

	it('creates both versions through the root factory and exposes the config', () => {
		const clock = new FakeClock();
		const factory = new FakeTransportFactory();
		const options16 = {
			version: '1.6' as const,
			url: 'ws://localhost/CP16',
			transport: factory.factory,
			clock,
			station: {
				id: 'CP16',
				vendor: 'Acme',
				model: 'AC-7',
				firmwareVersion: '1.0.0',
			},
		};
		const options201 = {
			version: '2.0.1' as const,
			url: 'ws://localhost/CP201',
			transport: factory.factory,
			clock,
			station: {
				id: 'CP201',
				vendorName: 'Acme',
				model: 'AC-22',
				firmwareVersion: '2.0.0',
			},
		};
		const legacy = createSimulator(options16);
		const modern = createSimulator(options201);
		expect(legacy).toBeInstanceOf(Simulator16);
		expect(modern).toBeInstanceOf(Simulator201);
		expect(legacy.getConfig()).toMatchObject({
			version: '1.6',
			url: 'ws://localhost/CP16',
			ready: false,
		});
		expect(modern.getConfig()).toMatchObject({
			version: '2.0.1',
			url: 'ws://localhost/CP201',
			ready: false,
		});
		legacy.dispose();
		modern.dispose();
	});

	it('omits empty report arrays and derives variable characteristics', async () => {
		const { simulator, transport } = await ready201();
		await simulator.deviceModel.sendReport({ requestId: 3, reportData: [] });
		let report = sentCalls(transport).find((call) => call.action === 'NotifyReport');
		expect(report?.payload).toMatchObject({ requestId: 3, seqNo: 0, tbc: false });
		expect(typeof report?.payload['generatedAt']).toBe('string');
		expect(report?.payload).not.toHaveProperty('reportData');

		transport.sent.length = 0;
		simulator.state.variables['Heartbeat/Interval'] = '60';
		await simulator.deviceModel.sendReport({ requestId: 4 });
		report = sentCalls(transport).find((call) => call.action === 'NotifyReport');
		const reportData = report?.payload['reportData'] as unknown[];
		expect(reportData).toHaveLength(5);
		expect(reportData).toContainEqual({
			component: { name: 'Heartbeat' },
			variable: { name: 'Interval' },
			variableAttribute: [{ type: 'Actual', value: '60', mutability: 'ReadWrite' }],
			variableCharacteristics: { dataType: 'integer', supportsMonitoring: true },
		});
		simulator.dispose();
	});

	it('maps monitors to report entries without simulator-only fields', async () => {
		const { simulator, transport } = await ready201();
		await simulator.monitoring.sendReport({ requestId: 5 });
		const empty = sentCalls(transport).find((call) => call.action === 'NotifyMonitoringReport');
		expect(empty?.payload).not.toHaveProperty('monitor');

		transport.sent.length = 0;
		simulator.state.monitoring.monitors.push({
			id: 1,
			component: { name: 'SampledData' },
			variable: { name: 'Power' },
			value: 100,
			type: 'UpperThreshold',
			severity: 3,
			transaction: false,
			triggered: true,
			lastReportedValue: 99,
		});
		await simulator.monitoring.sendReport({ requestId: 6 });
		const report = sentCalls(transport).find((call) => call.action === 'NotifyMonitoringReport');
		expect(report?.payload['monitor']).toEqual([
			{
				component: { name: 'SampledData' },
				variable: { name: 'Power' },
				variableMonitoring: [
					{
						id: 1,
						transaction: false,
						value: 100,
						type: 'UpperThreshold',
						severity: 3,
					},
				],
			},
		]);
		simulator.dispose();
	});

	it('validates the monitoring base at runtime', async () => {
		const { simulator } = await ready201();
		const base = simulator.state.monitoring.base;
		await expect(simulator.monitoring.setBase('Bogus' as never)).resolves.toEqual({
			status: 'NotSupported',
		});
		expect(simulator.state.monitoring.base).toBe(base);
		simulator.dispose();
	});
});
