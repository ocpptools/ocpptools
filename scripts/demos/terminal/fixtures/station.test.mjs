// SPDX-License-Identifier: Apache-2.0
// SPDX-FileCopyrightText: 2026 Rodolfo Carrillo

// Demo tests for docs/assets/testing-vitest.gif. They are the two samples of
// docs/guides/test-without-a-network.md and run against the published packages
// in the recording workspace, not in the repository test suite.

import { createSimulator16 } from '@ocpptools/simulator/1.6';
import {
	createFakeClock,
	createFrameFactory,
	createInMemoryTransportPair,
	createMockCsms,
	flushMicrotasks,
} from '@ocpptools/testing';
import { expect, it } from 'vitest';

it('boots and sends a heartbeat', async () => {
	const clock = createFakeClock();
	const pair = createInMemoryTransportPair();
	const csms = createMockCsms({
		version: '1.6',
		transport: pair.server,
		handlers: {
			BootNotification: () => ({
				status: 'Accepted',
				currentTime: '2026-01-01T00:00:00Z',
				interval: 60,
			}),
			StatusNotification: () => ({}),
			Heartbeat: () => ({ currentTime: '2026-01-01T00:01:00Z' }),
		},
	});
	const simulator = createSimulator16({
		url: 'ws://in-memory/CP-1',
		transport: () => pair.client,
		clock,
		station: { id: 'CP-1', vendor: 'Acme', model: 'AC-7', firmwareVersion: '1.0.0' },
	});

	simulator.connect();
	pair.link.open();
	for (let attempt = 0; attempt < 20 && !simulator.isReady; attempt += 1) {
		await flushMicrotasks(5);
	}
	expect(simulator.isReady).toBe(true);

	await simulator.sendHeartbeat();
	await csms.waitForIdle();

	const actions = csms.calls.map((call) => call[2]);
	expect(actions[0]).toBe('BootNotification');
	expect(actions).toContain('Heartbeat');
	simulator.dispose();
});

it('answers a Heartbeat CALL', async () => {
	const pair = createInMemoryTransportPair();
	const csms = createMockCsms({
		version: '2.0.1',
		transport: pair.server,
		handlers: { Heartbeat: () => ({ currentTime: '2026-01-01T00:00:00Z' }) },
	});
	const frames = createFrameFactory({ version: '2.0.1' });

	pair.link.open();
	pair.client.send(JSON.stringify(frames.call('Heartbeat', {})));
	await pair.link.flush();
	await csms.waitForIdle();

	expect(csms.calls).toHaveLength(1);
	expect(csms.results[0][2]).toEqual({ currentTime: '2026-01-01T00:00:00Z' });
});
