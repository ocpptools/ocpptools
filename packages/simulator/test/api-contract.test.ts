// SPDX-License-Identifier: Apache-2.0
// SPDX-FileCopyrightText: 2026 Rodolfo Carrillo

import { describe, expect, it } from 'vitest';

import { createSimulator, SimulatorError } from '@ocpptools/simulator';
import { createSimulator16, Simulator16 } from '@ocpptools/simulator/1.6';
import { createSimulator201, Simulator201 } from '@ocpptools/simulator/2.0.1';

import { FakeClock, flushMicrotasks } from './helpers/fake-clock.js';
import { FakeTransportFactory } from './helpers/fake-transport.js';

function options16() {
	return {
		url: 'ws://localhost/CP16',
		transport: new FakeTransportFactory().factory,
		clock: new FakeClock(),
		station: {
			id: 'CP16',
			vendor: 'Acme',
			model: 'AC-7',
			firmwareVersion: '1.0.0',
			connectorCount: 1,
		},
	};
}

function options201() {
	return {
		url: 'ws://localhost/CP201',
		transport: new FakeTransportFactory().factory,
		clock: new FakeClock(),
		station: {
			id: 'CP201',
			vendorName: 'Acme',
			model: 'AC-22',
			firmwareVersion: '2.0.0',
		},
	};
}

describe('simulator public API', () => {
	it('creates both protocol versions through factories', () => {
		const s16 = createSimulator16(options16());
		const s201 = createSimulator201(options201());
		expect(s16).toBeInstanceOf(Simulator16);
		expect(s201).toBeInstanceOf(Simulator201);
		expect(createSimulator({ version: '1.6', ...options16() })).toBeInstanceOf(Simulator16);
		expect(createSimulator({ version: '2.0.1', ...options201() })).toBeInstanceOf(Simulator201);
		expect(() => createSimulator({ version: '9.9', ...options16() } as never)).toThrow(
			SimulatorError,
		);
		expect(() => createSimulator({ version: '2.1.0', ...options16() } as never)).toThrow(
			'Unsupported simulator version: 2.1.0',
		);
	});

	it('exposes the lifecycle aliases and sub-apis', async () => {
		const simulator = createSimulator16(options16());
		expect(simulator.transactions).toHaveProperty('start');
		expect(simulator.transactions).toHaveProperty('startSession');
		expect(simulator.transactions).toHaveProperty('stop');
		expect(simulator.transactions).toHaveProperty('meter');
		expect(simulator.localAuth.getVersion()).toBe(0);
		expect(simulator.localAuth.list()).toEqual([]);
		expect(simulator.reservations.list()).toEqual([]);
		expect(simulator.chargingProfiles.list()).toEqual([]);
		expect(simulator.availability).toHaveProperty('setPower');
		expect(simulator.getPendingCalls()).toEqual([]);
		expect(simulator.getQueueLength()).toBe(0);
		simulator.clearQueue();
		simulator.clearHistory();
		simulator.resetMetrics();
		simulator.setReconnectOptions({ enabled: false });
		simulator.dispose();

		const modern = createSimulator201(options201());
		expect(modern.deviceModel.variables()).toEqual(expect.any(Object));
		expect(modern.monitoring.list()).toEqual([]);
		expect(modern.localAuth.getVersion()).toBe(0);
		expect(modern.reservations.list()).toEqual([]);
		expect(modern.chargingProfiles.list()).toEqual([]);
		expect(modern.display.list()).toEqual([]);
		expect(modern.certificates.list()).toEqual([]);
		expect(modern.firmware).toHaveProperty('sendStatus');
		expect(modern.customer).toHaveProperty('sendCustomerInformation');
		expect(modern.transactions).toHaveProperty('startSession');
		expect(modern.availability).toHaveProperty('setPower');
		await expect(modern.monitoring.setLevel(3)).resolves.toEqual({ status: 'Accepted' });
		await expect(modern.monitoring.setBase('FactoryDefault')).resolves.toEqual({
			status: 'Accepted',
		});
		modern.dispose();
	});

	it('starts a transaction without Authorize and sends manual meter values', async () => {
		const clock = new FakeClock();
		const factory = new FakeTransportFactory();
		let ids = 0;
		const simulator = createSimulator16({
			...options16(),
			clock,
			transport: factory.factory,
			messageIds: () => `m-${++ids}`,
			boot: { auto: false, required: false },
		});
		simulator.connect();
		const transport = factory.transports[0]!;
		const sent: string[] = [];
		transport.send = (text: string): void => {
			sent.push(text);
			const frame = JSON.parse(text) as unknown[];
			if (frame[0] !== 2) return;
			const action = String(frame[2]);
			const response: Record<string, unknown> =
				action === 'StartTransaction'
					? { transactionId: 77, idTagInfo: { status: 'Accepted' } }
					: {};
			transport.receive(JSON.stringify([3, frame[1], response]));
		};
		transport.open();
		await flushMicrotasks(30);
		const result = await simulator.transactions.start(1, 'A');
		expect(result).toMatchObject({ ok: true, transactionId: 77 });
		const actions = sent
			.map((text) => JSON.parse(text) as unknown[])
			.filter((frame) => frame[0] === 2)
			.map((frame) => String(frame[2]));
		expect(actions).toContain('StartTransaction');
		expect(actions).not.toContain('Authorize');
		const before = simulator.getConnector(1)?.meterWh;
		await simulator.transactions.meter(1);
		expect(simulator.getConnector(1)?.meterWh).toBe(before);
		expect(sent.some((text) => text.includes('MeterValues'))).toBe(true);
		simulator.dispose();
	});
});
