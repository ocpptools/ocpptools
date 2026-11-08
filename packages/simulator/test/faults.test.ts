// SPDX-License-Identifier: Apache-2.0
// SPDX-FileCopyrightText: 2026 Rodolfo Carrillo

import { describe, expect, it } from 'vitest';

import type { FaultConfig } from '../src/state.js';
import { Scheduler } from '../src/clock.js';
import { EventEmitter } from '../src/events.js';
import { History } from '../src/log.js';
import { OutboundPipeline } from '../src/outbound.js';
import { Simulator16 } from '../src/1.6.js';
import { FakeClock, flushMicrotasks } from './helpers/fake-clock.js';
import { FakeTransportFactory } from './helpers/fake-transport.js';

interface LabOptions {
	readonly random?: () => number;
	readonly faults?: Partial<FaultConfig>;
	readonly bootRequired?: boolean;
}

async function lab(options: LabOptions = {}) {
	const clock = new FakeClock();
	const factory = new FakeTransportFactory();
	let sequence = 0;
	const simulator = new Simulator16({
		url: 'ws://localhost/CP16',
		transport: factory.factory,
		clock,
		messageIds: () => `id-${++sequence}`,
		...(options.random === undefined ? {} : { random: options.random }),
		...(options.faults === undefined ? {} : { faults: options.faults }),
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
	return { clock, factory, simulator, transport };
}

describe('outbound faults', () => {
	it('drops a CALL without sending and lets the pending call time out', async () => {
		const { clock, simulator, transport } = await lab({
			faults: { dropRate: 1 },
			random: () => 0,
		});
		transport.sent.length = 0;
		const faults: string[] = [];
		simulator.on('fault', (event) => {
			faults.push(`${event.kind}:${event.action}`);
		});
		const call = simulator.sendCall('Heartbeat', {});
		const rejection = expect(call).rejects.toMatchObject({ code: 'timeout' });
		await flushMicrotasks();
		expect(transport.sent).toHaveLength(0);
		clock.advance(15_000);
		await rejection;
		expect(faults).toContain('drop:Heartbeat');
		expect(simulator.getHistory().some((entry) => entry.action.startsWith('[DROP]'))).toBe(true);
		simulator.dispose();
	});

	it('drops a CALLRESULT without replying to the peer', async () => {
		const { simulator, transport } = await lab({ faults: { dropRate: 1 }, random: () => 0 });
		const faults: string[] = [];
		simulator.on('fault', (event) => {
			faults.push(`${event.kind}:${event.action}`);
		});
		simulator.rpc.handleText('[2,"in-1","GetConfiguration",{}]');
		await flushMicrotasks(30);
		expect(transport.sent.some((text) => text.includes('[3,"in-1"'))).toBe(false);
		expect(faults).toContain('drop:CALLRESULT');
		simulator.dispose();
	});

	it('sends a truncated CALL and records the malformed fault', async () => {
		const { simulator, transport, clock } = await lab({
			faults: { malformRate: 1 },
			random: () => 0,
		});
		transport.sent.length = 0;
		const faults: string[] = [];
		simulator.on('fault', (event) => {
			faults.push(`${event.kind}:${event.action}`);
		});
		const call = simulator.sendCall('Heartbeat', {});
		void call.catch(() => undefined);
		const rejection = expect(call).rejects.toMatchObject({ code: 'timeout' });
		await flushMicrotasks();
		expect(transport.sent).toHaveLength(1);
		expect(() => {
			JSON.parse(transport.sent[0]!);
		}).toThrow();
		expect(faults).toContain('malform:Heartbeat');
		expect(simulator.getHistory().some((entry) => entry.action.startsWith('[MALFORMED]'))).toBe(
			true,
		);
		clock.advance(15_000);
		await rejection;
		simulator.dispose();
	});

	it('delays a CALL and sends it after the latency', async () => {
		const clock = new FakeClock();
		const scheduler = new Scheduler(clock);
		const events = new EventEmitter(() => clock.now());
		const history = new History();
		const sent: string[] = [];
		const faults: Array<{ kind: string; action: string }> = [];
		events.on('fault', (event) => {
			faults.push({ kind: event.kind, action: event.action });
		});
		const pipeline = new OutboundPipeline({
			scheduler,
			events,
			history,
			random: () => 0,
			getFaults: () => ({ latencyMs: 500, dropRate: 0, malformRate: 0 }),
			getEpoch: () => 0,
			isOpen: () => true,
			sendText: (text) => {
				sent.push(text);
			},
		});
		const delivery = pipeline.deliver({
			text: '[2,"id-1","Heartbeat",{}]',
			kind: 'CALL',
			action: 'Heartbeat',
			messageId: 'id-1',
		});
		await flushMicrotasks();
		expect(sent).toHaveLength(0);
		clock.advance(499);
		await flushMicrotasks();
		expect(sent).toHaveLength(0);
		clock.advance(1);
		await expect(delivery).resolves.toMatchObject({ delivered: true, malformed: false });
		expect(sent).toEqual(['[2,"id-1","Heartbeat",{}]']);
		expect(faults).toContainEqual({ kind: 'latency', action: 'Heartbeat' });
	});

	it('cancels a delayed send when the connection closes', async () => {
		const { clock, simulator, transport } = await lab();
		simulator.setFaults({ latencyMs: 500 });
		transport.sent.length = 0;
		const call = simulator.sendCall('Heartbeat', {});
		const rejection = expect(call).rejects.toMatchObject({ code: 'disconnected' });
		await flushMicrotasks();
		simulator.disconnect();
		clock.advance(500);
		await rejection;
		expect(transport.sent).toHaveLength(0);
		simulator.dispose();
	});

	it('does not send a delayed CALL on a new connection', async () => {
		const { clock, factory, simulator, transport } = await lab();
		simulator.setFaults({ latencyMs: 500 });
		transport.sent.length = 0;
		const call = simulator.sendCall('Heartbeat', {});
		const rejection = expect(call).rejects.toMatchObject({ code: 'disconnected' });
		await flushMicrotasks();
		transport.close(1006, 'lost');
		clock.advance(1000);
		const second = factory.transports[1];
		second?.open();
		await flushMicrotasks(120);
		clock.advance(1000);
		await flushMicrotasks(120);
		await rejection;
		expect(
			second?.sent
				.map((text) => JSON.parse(text) as unknown[])
				.some((frame) => frame[2] === 'Heartbeat'),
		).toBe(false);
		simulator.dispose();
	});

	it('preserves the queue when latency is cancelled by a close', async () => {
		const { clock, simulator, transport } = await lab({ bootRequired: true });
		await simulator.sendOrQueue('Authorize', { idTag: 'A' });
		simulator.on('boot', (event) => {
			if (event.status === 'accepted') {
				simulator.setFaults({ latencyMs: 500 });
			}
		});
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
		await flushMicrotasks(30);
		simulator.disconnect();
		await flushMicrotasks(30);
		expect(simulator.getQueue().some((entry) => entry.action === 'Authorize')).toBe(true);
		clock.advance(1000);
		await flushMicrotasks(30);
		expect(
			transport.sent
				.map((text) => JSON.parse(text) as unknown[])
				.some((frame) => frame[2] === 'Authorize'),
		).toBe(false);
		simulator.dispose();
	});

	it('does not send a delayed CALL after clearPendingCalls', async () => {
		const { clock, simulator, transport } = await lab();
		simulator.setFaults({ latencyMs: 500 });
		transport.sent.length = 0;
		const frames: unknown[] = [];
		simulator.on('frame', (event) => {
			if (event.direction === 'sent') frames.push(event.frame);
		});
		const call = simulator.sendCall('Heartbeat', {});
		const rejection = expect(call).rejects.toMatchObject({ code: 'cancelled' });
		await flushMicrotasks();
		simulator.clearPendingCalls();
		clock.advance(500);
		await rejection;
		await flushMicrotasks();
		expect(transport.sent).toHaveLength(0);
		expect(frames).toHaveLength(0);
		simulator.dispose();
	});

	it('reports a dropped CALLRESULT as not delivered', async () => {
		const { simulator, transport } = await lab({ faults: { dropRate: 1 }, random: () => 0 });
		transport.sent.length = 0;
		await expect(simulator.sendCallResult('in-3', {})).resolves.toBe(false);
		expect(transport.sent).toHaveLength(0);
		simulator.dispose();
	});

	it('queues a CALL whose latency was cancelled by a close', async () => {
		const { clock, simulator } = await lab();
		simulator.setFaults({ latencyMs: 500 });
		const sending = simulator.sendOrQueue('Authorize', { idTag: 'A' });
		await flushMicrotasks();
		simulator.disconnect();
		await expect(sending).resolves.toBe('queued');
		expect(simulator.getQueue().some((entry) => entry.action === 'Authorize')).toBe(true);
		clock.advance(1000);
		await flushMicrotasks();
		simulator.dispose();
	});

	it('drops a CALLERROR without sending it', async () => {
		const { simulator, transport } = await lab({ faults: { dropRate: 1 }, random: () => 0 });
		transport.sent.length = 0;
		const faults: string[] = [];
		simulator.on('fault', (event) => {
			faults.push(`${event.kind}:${event.action}`);
		});
		await expect(simulator.sendCallError('in-2', 'NotSupported', 'no')).resolves.toBe(false);
		expect(transport.sent).toHaveLength(0);
		expect(faults).toContain('drop:CALLERROR');
		simulator.dispose();
	});

	it('applies the pipeline when a queued CALL is flushed', async () => {
		const { simulator, transport } = await lab({ bootRequired: true });
		await simulator.sendOrQueue('Authorize', { idTag: 'A' });
		expect(simulator.getQueueLength()).toBe(1);
		simulator.on('boot', (event) => {
			if (event.status === 'accepted') {
				simulator.setFaults({ dropRate: 1 });
			}
		});
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
		expect(simulator.getQueueLength()).toBe(0);
		expect(
			transport.sent
				.map((text) => JSON.parse(text) as unknown[])
				.some((frame) => frame[2] === 'Authorize'),
		).toBe(false);
		simulator.dispose();
	});
});
