// SPDX-License-Identifier: Apache-2.0
// SPDX-FileCopyrightText: 2026 Rodolfo Carrillo

import { describe, expect, it } from 'vitest';

import { Simulator16 } from '../src/1.6.js';
import { Simulator201 } from '../src/2.0.1.js';
import type { ScenarioStep } from '../src/scenario.js';
import { FakeClock, flushMicrotasks } from './helpers/fake-clock.js';
import { FakeTransportFactory, type FakeTransport } from './helpers/fake-transport.js';

function autoRespond(
	transport: FakeTransport,
	startStatus: 'Accepted' | 'Invalid' = 'Accepted',
): void {
	const send = transport.send.bind(transport);
	transport.send = (text: string): void => {
		send(text);
		const frame = JSON.parse(text) as unknown[];
		if (frame[0] !== 2) return;
		const [, id, action] = frame as [number, string, string];
		const responses: Record<string, unknown> = {
			BootNotification: {
				status: 'Accepted',
				currentTime: '2026-01-01T00:00:00Z',
				interval: 60,
			},
			Authorize: {
				idTagInfo: { status: 'Accepted' },
				idTokenInfo: { status: 'Accepted' },
			},
			StartTransaction: { transactionId: 11, idTagInfo: { status: startStatus } },
			StopTransaction: { idTagInfo: { status: 'Accepted' } },
			Heartbeat: { currentTime: '2026-01-01T00:00:00Z' },
			DataTransfer: { status: 'Accepted' },
		};
		transport.receive(JSON.stringify([3, id, responses[action] ?? {}]));
	};
}

async function ready16(startStatus: 'Accepted' | 'Invalid' = 'Accepted') {
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
			connectorCount: 1,
			defaultIdTag: 'TAG',
		},
	});
	simulator.connect();
	const transport = factory.transports[0]!;
	autoRespond(transport, startStatus);
	transport.open();
	await flushMicrotasks(60);
	return { clock, factory, simulator, transport };
}

async function ready201() {
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
			defaultIdToken: 'TAG',
		},
	});
	simulator.connect();
	const transport = factory.transports[0]!;
	autoRespond(transport);
	transport.open();
	await flushMicrotasks(60);
	return { clock, factory, simulator, transport };
}

describe('scenario runner', () => {
	it('runs all 1.6 steps sequentially and emits the lifecycle', async () => {
		const { simulator, clock } = await ready16();
		const phases: string[] = [];
		simulator.on('scenario', (event) => {
			phases.push(event.phase);
		});
		const steps: ScenarioStep[] = [
			{ type: 'heartbeat' },
			{ type: 'status', connectorId: 1, status: 'Available' },
			{ type: 'authorize', idTag: 'TAG' },
			{ type: 'start', connectorId: 1, idToken: 'TAG' },
			{ type: 'wait', ms: 1000 },
			{ type: 'meter', connectorId: 1 },
			{ type: 'stop', connectorId: 1 },
			{ type: 'call', action: 'DataTransfer', payload: { vendorId: 'x' } },
		];
		const run = simulator.runScenario(steps);
		await flushMicrotasks(60);
		clock.advance(1000);
		const result = await run.done;
		expect(result.status).toBe('completed');
		expect(result.steps.every((step) => step.status === 'ok')).toBe(true);
		expect(result.steps).toHaveLength(steps.length);
		expect(phases.filter((phase) => phase === 'step')).toHaveLength(steps.length);
		expect(phases).toContain('started');
		expect(phases.at(-1)).toBe('completed');
		expect(simulator.getState().completedTransactions).toHaveLength(1);
		simulator.dispose();
	});

	it('runs start, meter, and stop on 2.0.1', async () => {
		const { simulator } = await ready201();
		const result = await simulator.runScenario([
			{ type: 'start', evseId: 1, idToken: 'TAG' },
			{ type: 'meter', evseId: 1 },
			{ type: 'stop', evseId: 1 },
		]).done;
		expect(result.status).toBe('completed');
		expect(result.steps.map((step) => step.type)).toEqual(['start', 'meter', 'stop']);
		expect(simulator.getState().completedTransactions).toHaveLength(1);
		simulator.dispose();
	});

	it('fails without throwing when a step is rejected', async () => {
		const { simulator } = await ready16('Invalid');
		const result = await simulator.runScenario([{ type: 'start', connectorId: 1, idToken: 'TAG' }])
			.done;
		expect(result.status).toBe('failed');
		expect(result.steps[0]?.status).toBe('failed');
		expect(result.error?.code).toBe('scenario-failed');
		simulator.dispose();
	});

	it('cancels a wait without stopping the transaction by default', async () => {
		const { simulator } = await ready16();
		const run = simulator.runScenario([
			{ type: 'start', connectorId: 1, idToken: 'TAG' },
			{ type: 'wait', ms: 10_000 },
			{ type: 'stop', connectorId: 1 },
		]);
		await flushMicrotasks(60);
		run.cancel();
		const result = await run.done;
		expect(result.status).toBe('cancelled');
		expect(result.steps.map(({ type, status }) => `${type}:${status}`)).toEqual([
			'start:ok',
			'wait:skipped',
		]);
		expect(simulator.getConnector(1)?.activeTransaction).not.toBeNull();
		simulator.dispose();
	});

	it('stops a started transaction on cancel when requested', async () => {
		const { simulator } = await ready16();
		const run = simulator.runScenario(
			[
				{ type: 'start', connectorId: 1, idToken: 'TAG' },
				{ type: 'wait', ms: 10_000 },
			],
			{ stopOnCancel: true },
		);
		await flushMicrotasks(60);
		run.cancel();
		const result = await run.done;
		expect(result.status).toBe('cancelled');
		expect(simulator.getConnector(1)?.activeTransaction).toBeNull();
		expect(simulator.getState().completedTransactions).toHaveLength(1);
		simulator.dispose();
	});

	it('settles and cancels when the simulator is disposed during a wait', async () => {
		const { simulator } = await ready16();
		const run = simulator.runScenario([
			{ type: 'start', connectorId: 1, idToken: 'TAG' },
			{ type: 'wait', ms: 10_000 },
		]);
		await flushMicrotasks(60);
		simulator.dispose();
		const result = await run.done;
		expect(result.status).toBe('cancelled');
		expect(result.steps.map(({ type, status }) => `${type}:${status}`)).toEqual([
			'start:ok',
			'wait:skipped',
		]);
	});

	it('keeps the runChargingScenario helper compatible', async () => {
		const { clock, simulator } = await ready16();
		const run = simulator.runChargingScenario({
			connectorId: 1,
			idTag: 'TAG',
			durationMs: 2000,
			readings: 1,
		});
		await flushMicrotasks(60);
		clock.advance(2000);
		await expect(run.done).resolves.toBe(true);
		expect(simulator.getState().completedTransactions).toHaveLength(1);
		simulator.dispose();
	});

	it('provides the 2.0.1 charging helper', async () => {
		const { clock, simulator } = await ready201();
		const run = simulator.runChargingScenario({
			evseId: 1,
			idToken: 'TAG',
			durationMs: 2000,
			readings: 1,
		});
		await flushMicrotasks(60);
		clock.advance(2000);
		await expect(run.done).resolves.toBe(true);
		expect(simulator.getState().completedTransactions).toHaveLength(1);
		simulator.dispose();
	});
});
