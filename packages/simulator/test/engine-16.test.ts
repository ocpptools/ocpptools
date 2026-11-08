// SPDX-License-Identifier: Apache-2.0
// SPDX-FileCopyrightText: 2026 Rodolfo Carrillo

import { describe, expect, it } from 'vitest';

import { Simulator16 } from '../src/1.6.js';
import { FakeClock, flushMicrotasks } from './helpers/fake-clock.js';
import { FakeTransportFactory } from './helpers/fake-transport.js';

function harness() {
	const clock = new FakeClock();
	const factory = new FakeTransportFactory();
	let id = 0;
	const simulator = new Simulator16({
		url: 'ws://localhost/CP001',
		transport: factory.factory,
		clock,
		messageIds: () => `id-${++id}`,
		station: {
			id: 'CP001',
			vendor: 'Acme',
			model: 'AC-7',
			firmwareVersion: '1.0.0',
			connectorCount: 2,
			defaultIdTag: 'AABBCCDD',
		},
		boot: { auto: true, required: true },
	});
	return { clock, factory, simulator, nextId: () => `id-${id + 1}` };
}

function sentActions(transport: { sent: string[] }): string[] {
	return transport.sent.map((text) => {
		const frame = JSON.parse(text) as unknown[];
		return frame[0] === 2 ? String(frame[2]) : `type-${String(frame[0])}`;
	});
}

describe('Simulator16 engine', () => {
	it('boots, becomes ready, and sends status notifications', async () => {
		const { factory, simulator } = harness();
		simulator.connect();
		factory.transports[0]?.open();
		await flushMicrotasks();
		expect(sentActions(factory.transports[0]!)).toContain('BootNotification');
		const boot = JSON.parse(factory.transports[0]!.sent[0] ?? '[]') as unknown[];
		factory.transports[0]!.receive(
			JSON.stringify([
				3,
				boot[1],
				{ status: 'Accepted', currentTime: '2026-01-01T00:00:00Z', interval: 60 },
			]),
		);
		await flushMicrotasks();
		expect(simulator.getState().boot.status).toBe('accepted');
		expect(simulator.isReady).toBe(true);
		expect(sentActions(factory.transports[0]!)).toContain('StatusNotification');
		expect(simulator.getState().connectors).toHaveLength(2);
	});

	it('does not let a normal call run before boot is accepted', async () => {
		const { factory, simulator } = harness();
		simulator.connect();
		factory.transports[0]?.open();
		await flushMicrotasks();
		await expect(simulator.sendCall('Heartbeat', {})).rejects.toMatchObject({
			code: 'not-ready',
		});
	});

	it('queues a call while not ready and flushes it after boot', async () => {
		const { factory, simulator } = harness();
		simulator.connect();
		factory.transports[0]?.open();
		await flushMicrotasks();
		await expect(simulator.sendOrQueue('Authorize', { idTag: 'A' })).resolves.toBe('queued');
		expect(simulator.getQueue()).toHaveLength(1);
		const boot = JSON.parse(factory.transports[0]!.sent[0] ?? '[]') as unknown[];
		factory.transports[0]!.receive(
			JSON.stringify([
				3,
				boot[1],
				{ status: 'Accepted', currentTime: '2026-01-01T00:00:00Z', interval: 60 },
			]),
		);
		await flushMicrotasks(50);
		expect(sentActions(factory.transports[0]!)).toContain('Authorize');
		expect(simulator.getQueue()).toHaveLength(0);
	});

	it('does not start heartbeat or status loops when boot is rejected', async () => {
		const { factory, simulator } = harness();
		simulator.connect();
		factory.transports[0]?.open();
		await flushMicrotasks();
		const boot = JSON.parse(factory.transports[0]!.sent[0] ?? '[]') as unknown[];
		factory.transports[0]!.receive(JSON.stringify([3, boot[1], { status: 'Rejected' }]));
		await flushMicrotasks();
		expect(simulator.getState().boot.status).toBe('rejected');
		expect(simulator.isReady).toBe(false);
		const actions = sentActions(factory.transports[0]!);
		expect(actions.filter((action) => action === 'StatusNotification')).toHaveLength(0);
	});

	it('answers GetConfiguration and DataTransfer inbound calls', async () => {
		const { factory, simulator } = harness();
		simulator.connect();
		factory.transports[0]?.open();
		await flushMicrotasks();
		const boot = JSON.parse(factory.transports[0]!.sent[0] ?? '[]') as unknown[];
		factory.transports[0]!.receive(
			JSON.stringify([
				3,
				boot[1],
				{ status: 'Accepted', currentTime: '2026-01-01T00:00:00Z', interval: 60 },
			]),
		);
		await flushMicrotasks();
		factory.transports[0]!.receive('[2,"in-1","GetConfiguration",{}]');
		factory.transports[0]!.receive('[2,"in-2","DataTransfer",{"vendorId":"x"}]');
		await flushMicrotasks();
		const responses = factory.transports[0]!.sent.filter((text) => text.startsWith('[3,"in-'));
		expect(responses).toHaveLength(2);
	});

	it('becomes ready on open when boot is not required', async () => {
		const clock = new FakeClock();
		const factory = new FakeTransportFactory();
		const simulator = new Simulator16({
			url: 'ws://localhost/CP001',
			transport: factory.factory,
			clock,
			messageIds: () => 'id-1',
			station: {
				id: 'CP001',
				vendor: 'Acme',
				model: 'AC-7',
				firmwareVersion: '1.0.0',
			},
			boot: { auto: false, required: false },
		});
		simulator.connect();
		factory.transports[0]?.open();
		await flushMicrotasks(50);
		expect(simulator.isReady).toBe(true);
		await expect(simulator.sendOrQueue('Authorize', { idTag: 'A' })).resolves.toBe('sent');
		simulator.dispose();
	});

	it('retries a Pending boot', async () => {
		const clock = new FakeClock();
		const factory = new FakeTransportFactory();
		let sequence = 0;
		const simulator = new Simulator16({
			url: 'ws://localhost/CP001',
			transport: factory.factory,
			clock,
			messageIds: () => `id-${++sequence}`,
			station: {
				id: 'CP001',
				vendor: 'Acme',
				model: 'AC-7',
				firmwareVersion: '1.0.0',
			},
		});
		simulator.connect();
		const transport = factory.transports[0]!;
		let boots = 0;
		transport.send = (text: string): void => {
			const frame = JSON.parse(text) as unknown[];
			if (frame[0] === 2 && frame[2] === 'BootNotification') {
				boots += 1;
				transport.receive(
					JSON.stringify([
						3,
						frame[1],
						{
							status: boots === 1 ? 'Pending' : 'Accepted',
							interval: 1,
							currentTime: '2026-01-01T00:00:00Z',
						},
					]),
				);
			}
		};
		transport.open();
		await flushMicrotasks(50);
		expect(simulator.getState().boot.status).toBe('pending');
		clock.advance(1000);
		await flushMicrotasks(50);
		expect(boots).toBe(2);
		expect(simulator.isReady).toBe(true);
		simulator.dispose();
	});

	it('validates modes and faults', () => {
		const { simulator } = harness();
		expect(() => simulator.setFaults({ dropRate: 2 })).toThrow('out of range');
		expect(() => simulator.setValidationMode('nope' as never)).toThrow('validation mode');
		expect(() => simulator.setInboundResponseMode('nope' as never)).toThrow('inbound response');
		simulator.setFaults({ latencyMs: 10 });
		expect(simulator.getFaults().latencyMs).toBe(10);
		expect(simulator.getConfig()).toMatchObject({ version: '1.6', ready: false });
	});

	it('disposes timers and pending calls', async () => {
		const { factory, simulator, clock } = harness();
		simulator.connect();
		factory.transports[0]?.open();
		await flushMicrotasks();
		const boot = JSON.parse(factory.transports[0]!.sent[0] ?? '[]') as unknown[];
		factory.transports[0]!.receive(
			JSON.stringify([
				3,
				boot[1],
				{ status: 'Accepted', currentTime: '2026-01-01T00:00:00Z', interval: 60 },
			]),
		);
		await flushMicrotasks();
		const pending = simulator.sendCall('Authorize', { idTag: 'A' }).catch(() => undefined);
		await flushMicrotasks();
		simulator.dispose();
		await pending;
		expect(simulator.scheduler.pendingTimers).toBe(0);
		clock.advance(60_000);
		expect(() => simulator.connect()).toThrow('disposed');
	});
});
