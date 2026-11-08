// SPDX-License-Identifier: Apache-2.0
// SPDX-FileCopyrightText: 2026 Rodolfo Carrillo

import { describe, expect, it } from 'vitest';

import { Metrics } from '../src/metrics.js';
import { Simulator16 } from '../src/1.6.js';
import { FakeClock, flushMicrotasks } from './helpers/fake-clock.js';
import { FakeTransportFactory, type FakeTransport } from './helpers/fake-transport.js';

describe('Metrics', () => {
	it('aggregates RTT per action', () => {
		const metrics = new Metrics();
		metrics.recordRtt('Authorize', 10);
		metrics.recordRtt('Authorize', 20);
		const snapshot = metrics.snapshot(0);
		expect(snapshot.rttByAction['Authorize']).toMatchObject({
			count: 2,
			totalMs: 30,
			lastMs: 20,
			maxMs: 20,
			averageMs: 15,
		});
	});

	it('prunes errors outside the minute window', () => {
		const metrics = new Metrics();
		metrics.recordError(1_000);
		expect(metrics.snapshot(2_000).errorCountLastMinute).toBe(1);
		expect(metrics.snapshot(70_000).errorCountLastMinute).toBe(0);
	});

	it('records heartbeat drift and resets the baseline', () => {
		const metrics = new Metrics();
		metrics.recordHeartbeat(1000, 0);
		metrics.recordHeartbeat(1000, 1500);
		expect(metrics.snapshot(2000).heartbeat).toMatchObject({
			samples: 1,
			lastDriftMs: 500,
			averageDriftMs: 500,
		});
		metrics.resetHeartbeat();
		metrics.recordHeartbeat(1000, 3000);
		expect(metrics.snapshot(4000).heartbeat.samples).toBe(1);
	});

	it('resets all metrics', () => {
		const metrics = new Metrics();
		metrics.recordRtt('A', 1);
		metrics.recordError(1);
		metrics.recordHeartbeat(1, 1);
		metrics.recordHeartbeat(1, 3);
		metrics.reset();
		expect(metrics.snapshot(10)).toEqual({
			errorCountLastMinute: 0,
			rttByAction: {},
			heartbeat: { samples: 0 },
		});
	});
});

async function lab(options: { bootRequired?: boolean } = {}) {
	const clock = new FakeClock();
	const factory = new FakeTransportFactory();
	let sequence = 0;
	const simulator = new Simulator16({
		url: 'ws://localhost/CP16',
		transport: factory.factory,
		clock,
		messageIds: () => `id-${++sequence}`,
		boot:
			options.bootRequired === true
				? { auto: false, required: true }
				: { auto: false, required: false },
		station: {
			id: 'CP16',
			vendor: 'Acme',
			model: 'AC-7',
			firmwareVersion: '1.0.0',
		},
	});
	simulator.connect();
	const transport = factory.transports[0]!;
	transport.open();
	await flushMicrotasks(60);
	if (options.bootRequired !== true) {
		expect(simulator.isReady).toBe(true);
	}
	return { clock, simulator, transport };
}

function respond(transport: FakeTransport): void {
	const send = transport.send.bind(transport);
	transport.send = (text: string): void => {
		send(text);
		const frame = JSON.parse(text) as unknown[];
		if (frame[0] !== 2) return;
		transport.receive(JSON.stringify([3, frame[1], { currentTime: '2026-01-01T00:00:00Z' }]));
	};
}

describe('engine metrics', () => {
	it('records RTT and emits metrics after a resolved call', async () => {
		const { simulator, transport } = await lab();
		respond(transport);
		const events: number[] = [];
		simulator.on('metrics', (event) => {
			events.push(event.errorCountLastMinute);
		});
		await simulator.sendCall('Heartbeat', {});
		expect(simulator.getMetrics().rttByAction['Heartbeat']?.count).toBe(1);
		expect(events.length).toBeGreaterThan(0);
		simulator.dispose();
	});

	it('counts a timeout and emits the metrics event', async () => {
		const { clock, simulator } = await lab();
		const events: number[] = [];
		simulator.on('metrics', (event) => {
			events.push(event.errorCountLastMinute);
		});
		const call = simulator.sendCall('Heartbeat', {});
		const rejection = expect(call).rejects.toMatchObject({ code: 'timeout' });
		await flushMicrotasks();
		clock.advance(15_000);
		await rejection;
		expect(simulator.getMetrics().errorCountLastMinute).toBe(1);
		expect(events.at(-1)).toBe(1);
		simulator.dispose();
	});

	it('counts an invalid inbound frame', async () => {
		const { simulator } = await lab();
		simulator.rpc.handleText('{not-json');
		await flushMicrotasks();
		expect(simulator.getMetrics().errorCountLastMinute).toBe(1);
		simulator.dispose();
	});

	it('counts a transport error once', async () => {
		const { simulator, transport } = await lab();
		transport.fail(new Error('wire down'));
		await flushMicrotasks();
		expect(simulator.getMetrics().errorCountLastMinute).toBe(1);
		simulator.dispose();
	});

	it('counts a heartbeat timeout once', async () => {
		const { clock, simulator } = await lab();
		clock.advance(60_000);
		await flushMicrotasks(60);
		clock.advance(15_000);
		await flushMicrotasks(60);
		expect(simulator.getMetrics().errorCountLastMinute).toBe(1);
		simulator.dispose();
	});

	it('counts a malformed pending response once', async () => {
		const { simulator } = await lab();
		const call = simulator.sendCall('Heartbeat', {});
		const rejection = expect(call).rejects.toMatchObject({ code: 'invalid-response' });
		await flushMicrotasks();
		const pending = simulator.getPendingCalls()[0]!;
		simulator.rpc.handleText(JSON.stringify([3, pending.messageId]));
		await rejection;
		expect(simulator.getMetrics().errorCountLastMinute).toBe(1);
		simulator.dispose();
	});

	it('counts a CALLERROR for a queued call', async () => {
		const { simulator, transport } = await lab({ bootRequired: true });
		await simulator.sendOrQueue('Authorize', { idTag: 'A' });
		const queued = simulator.getQueue()[0]!;
		const send = transport.send.bind(transport);
		transport.send = (text: string): void => {
			send(text);
			const frame = JSON.parse(text) as unknown[];
			if (frame[0] === 2 && frame[2] === 'BootNotification') {
				transport.receive(
					JSON.stringify([
						3,
						frame[1],
						{ status: 'Accepted', currentTime: '2026-01-01T00:00:00Z', interval: 60 },
					]),
				);
			}
		};
		await simulator.bootNotification();
		await flushMicrotasks(60);
		expect(queued.action).toBe('Authorize');
		simulator.rpc.handleText(JSON.stringify([4, queued.messageId, 'NotSupported', 'no', {}]));
		await flushMicrotasks();
		expect(simulator.getMetrics().errorCountLastMinute).toBe(1);
		simulator.dispose();
	});

	it('counts a queue replay send failure once', async () => {
		const { simulator, transport } = await lab({ bootRequired: true });
		await simulator.sendOrQueue('Authorize', { idTag: 'A' });
		const send = transport.send.bind(transport);
		transport.send = (text: string): void => {
			const frame = JSON.parse(text) as unknown[];
			if (frame[0] === 2 && frame[2] === 'Authorize') {
				throw new Error('wire down');
			}
			send(text);
			if (frame[0] === 2 && frame[2] === 'BootNotification') {
				transport.receive(
					JSON.stringify([
						3,
						frame[1],
						{ status: 'Accepted', currentTime: '2026-01-01T00:00:00Z', interval: 60 },
					]),
				);
			}
		};
		await simulator.bootNotification();
		await flushMicrotasks(60);
		expect(simulator.getQueueLength()).toBe(1);
		expect(simulator.getMetrics().errorCountLastMinute).toBe(1);
		simulator.dispose();
	});

	it('counts a direct send failure once', async () => {
		const { simulator, transport } = await lab();
		transport.send = () => {
			throw new Error('wire down');
		};
		await expect(
			simulator.sendOrQueue('StatusNotification', { connectorId: 1, status: 'Available' }),
		).rejects.toMatchObject({ code: 'send-failed' });
		expect(simulator.getMetrics().errorCountLastMinute).toBe(1);
		simulator.dispose();
	});

	it('counts a handler timeout once', async () => {
		const { clock, simulator } = await lab();
		simulator.rpc.handleText('[2,"in-1","TriggerMessage",{"requestedMessage":"Heartbeat"}]');
		await flushMicrotasks(60);
		clock.advance(15_000);
		await flushMicrotasks(60);
		expect(simulator.getMetrics().errorCountLastMinute).toBe(1);
		simulator.dispose();
	});

	it('resets the counters and emits a zero metrics event', async () => {
		const { simulator } = await lab();
		simulator.rpc.handleText('{not-json');
		await flushMicrotasks();
		const events: number[] = [];
		simulator.on('metrics', (event) => {
			events.push(event.errorCountLastMinute);
		});
		simulator.resetMetrics();
		expect(simulator.getMetrics()).toEqual({
			errorCountLastMinute: 0,
			rttByAction: {},
			heartbeat: { samples: 0 },
		});
		expect(events.at(-1)).toBe(0);
		simulator.dispose();
	});

	it('records heartbeat drift when the call completes', async () => {
		const { clock, simulator, transport } = await lab();
		respond(transport);
		clock.advance(60_000);
		await flushMicrotasks(60);
		clock.advance(60_000);
		await flushMicrotasks(60);
		const heartbeat = simulator.getMetrics().heartbeat;
		expect(heartbeat.samples).toBe(1);
		expect(heartbeat.lastDriftMs).toBe(0);
		simulator.dispose();
	});
});
