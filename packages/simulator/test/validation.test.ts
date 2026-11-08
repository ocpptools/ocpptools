// SPDX-License-Identifier: Apache-2.0
// SPDX-FileCopyrightText: 2026 Rodolfo Carrillo

import type { CallFrame } from '@ocpptools/core';
import { describe, expect, it } from 'vitest';

import { SimulatorValidationError } from '../src/errors.js';
import { Simulator16 } from '../src/1.6.js';
import { FakeClock, flushMicrotasks } from './helpers/fake-clock.js';
import { FakeTransportFactory, type FakeTransport } from './helpers/fake-transport.js';

interface LabOptions {
	readonly mode?: 'off' | 'warn' | 'block';
	readonly validateOutbound?: (
		frame: CallFrame,
	) => readonly string[] | null | Promise<readonly string[] | null>;
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
		boot:
			options.bootRequired === true
				? { auto: false, required: true }
				: { auto: false, required: false },
		validation: {
			...(options.mode === undefined ? {} : { mode: options.mode }),
			...(options.validateOutbound === undefined
				? {}
				: { validateOutbound: options.validateOutbound }),
		},
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

function respond(transport: FakeTransport): void {
	const send = transport.send.bind(transport);
	transport.send = (text: string): void => {
		send(text);
		const frame = JSON.parse(text) as unknown[];
		if (frame[0] !== 2) return;
		transport.receive(JSON.stringify([3, frame[1], { currentTime: '2026-01-01T00:00:00Z' }]));
	};
}

describe('outbound validation', () => {
	it('warns, notices, logs, and sends when the callback reports errors', async () => {
		const { simulator, transport } = await lab({
			mode: 'warn',
			validateOutbound: () => ['bad payload'],
		});
		respond(transport);
		const validation: Array<{ blocked: boolean; errors: readonly string[] }> = [];
		const notices: string[] = [];
		simulator.on('validation', (event) => {
			validation.push({ blocked: event.blocked, errors: event.errors });
		});
		simulator.on('notice', (event) => {
			notices.push(event.code ?? '');
		});
		await expect(simulator.sendCall('Heartbeat', {})).resolves.toEqual({
			currentTime: '2026-01-01T00:00:00Z',
		});
		expect(validation).toEqual([{ blocked: false, errors: ['bad payload'] }]);
		expect(notices).toContain('validation');
		expect(simulator.getHistory().some((entry) => entry.action.startsWith('[VALIDATION]'))).toBe(
			true,
		);
		expect(simulator.getMetrics().errorCountLastMinute).toBe(0);
		simulator.dispose();
	});

	it('blocks a CALL before sending and records one error', async () => {
		const { simulator, transport } = await lab({
			mode: 'block',
			validateOutbound: (frame) => (frame[2] === 'Heartbeat' ? ['bad payload'] : null),
		});
		const blocked: boolean[] = [];
		simulator.on('validation', (event) => {
			blocked.push(event.blocked);
		});
		transport.sent.length = 0;
		await expect(simulator.sendCall('Heartbeat', {})).rejects.toBeInstanceOf(
			SimulatorValidationError,
		);
		expect(transport.sent).toHaveLength(0);
		expect(blocked).toEqual([true]);
		expect(simulator.getMetrics().errorCountLastMinute).toBe(1);
		simulator.dispose();
	});

	it('supports async callbacks and accepts null or empty results', async () => {
		const seen: string[] = [];
		const { simulator, transport } = await lab({
			mode: 'warn',
			validateOutbound: async (frame) => {
				await Promise.resolve();
				if (frame[2] !== 'Heartbeat') return null;
				seen.push(frame[2]);
				return frame[2] === 'Heartbeat' ? null : [];
			},
		});
		respond(transport);
		await expect(simulator.sendCall('Heartbeat', {})).resolves.toBeDefined();
		await expect(simulator.sendCall('Heartbeat', {})).resolves.toBeDefined();
		expect(seen).toEqual(['Heartbeat', 'Heartbeat']);
		simulator.dispose();
	});

	it('reports a throwing callback and continues in warn mode', async () => {
		const { simulator, transport } = await lab({
			mode: 'warn',
			validateOutbound: (frame) => {
				if (frame[2] !== 'Heartbeat') return null;
				throw new Error('validator exploded');
			},
		});
		respond(transport);
		const errors: string[] = [];
		simulator.on('error', (event) => {
			errors.push(event.error.message);
		});
		await expect(simulator.sendCall('Heartbeat', {})).resolves.toBeDefined();
		expect(errors).toContain('validator exploded');
		expect(simulator.getMetrics().errorCountLastMinute).toBe(1);
		simulator.dispose();
	});

	it('rejects a throwing callback in block mode', async () => {
		const { simulator, transport } = await lab({
			mode: 'block',
			validateOutbound: (frame) => {
				if (frame[2] !== 'Heartbeat') return null;
				throw new Error('validator exploded');
			},
		});
		transport.sent.length = 0;
		await expect(simulator.sendCall('Heartbeat', {})).rejects.toMatchObject({
			code: 'validation-blocked',
		});
		expect(transport.sent).toHaveLength(0);
		expect(simulator.getMetrics().errorCountLastMinute).toBe(1);
		simulator.dispose();
	});

	it('skips validation in off mode and for responses', async () => {
		let calls = 0;
		const { simulator, transport } = await lab({
			mode: 'off',
			validateOutbound: () => {
				calls += 1;
				return ['nope'];
			},
		});
		respond(transport);
		await expect(simulator.sendCall('Heartbeat', {})).resolves.toBeDefined();
		simulator.rpc.handleText('[2,"in-1","GetConfiguration",{}]');
		await flushMicrotasks(30);
		expect(calls).toBe(0);
		simulator.dispose();
	});

	it('blocks a queued CALL before it enters the queue', async () => {
		const { simulator } = await lab({
			mode: 'block',
			validateOutbound: () => ['bad payload'],
			bootRequired: true,
		});
		await expect(simulator.sendOrQueue('Authorize', { idTag: 'A' })).rejects.toMatchObject({
			code: 'validation-blocked',
		});
		expect(simulator.getQueueLength()).toBe(0);
		simulator.dispose();
	});

	it('cancels a call that is waiting on async validation', async () => {
		let release: () => void = () => undefined;
		const gate = new Promise<void>((resolve) => {
			release = resolve;
		});
		const { simulator, transport } = await lab({
			mode: 'warn',
			validateOutbound: async (frame) => {
				if (frame[2] !== 'Heartbeat') return null;
				await gate;
				return null;
			},
		});
		transport.sent.length = 0;
		const call = simulator.sendCall('Heartbeat', {});
		const rejection = expect(call).rejects.toMatchObject({ code: 'cancelled' });
		await flushMicrotasks();
		simulator.clearPendingCalls();
		release();
		await rejection;
		await flushMicrotasks(30);
		expect(
			transport.sent
				.map((text) => JSON.parse(text) as unknown[])
				.some((frame) => frame[2] === 'Heartbeat'),
		).toBe(false);
		simulator.dispose();
	});

	it('enqueues synchronously when validation is off', async () => {
		const { simulator } = await lab({ bootRequired: true });
		const sending = simulator.sendOrQueue('Authorize', { idTag: 'A' });
		simulator.clearQueue();
		await expect(sending).resolves.toBe('queued');
		expect(simulator.getQueueLength()).toBe(0);
		simulator.dispose();
	});

	it('rejects an async validation that crosses a reconnection', async () => {
		let release: () => void = () => undefined;
		const gate = new Promise<void>((resolve) => {
			release = resolve;
		});
		const { clock, factory, simulator, transport } = await lab({
			mode: 'warn',
			validateOutbound: async (frame) => {
				if (frame[2] !== 'Heartbeat') return null;
				await gate;
				return null;
			},
		});
		const call = simulator.sendCall('Heartbeat', {});
		const rejection = expect(call).rejects.toMatchObject({ code: 'disconnected' });
		await flushMicrotasks();
		transport.close(1006, 'lost');
		clock.advance(1000);
		const second = factory.transports[1];
		second?.open();
		await flushMicrotasks(120);
		release();
		await rejection;
		await flushMicrotasks(30);
		expect(
			second?.sent
				.map((text) => JSON.parse(text) as unknown[])
				.some((frame) => frame[2] === 'Heartbeat'),
		).toBe(false);
		simulator.dispose();
	});
});
