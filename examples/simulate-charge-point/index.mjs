// SPDX-License-Identifier: Apache-2.0
// SPDX-FileCopyrightText: 2026 Rodolfo Carrillo

import { pathToFileURL } from 'node:url';

import { createSimulator16 } from '@ocpptools/simulator/1.6';
import {
	createFakeClock,
	createInMemoryTransportPair,
	createMockCsms,
	flushMicrotasks,
} from '@ocpptools/testing';

export async function run() {
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
			Authorize: () => ({ idTagInfo: { status: 'Accepted' } }),
			StartTransaction: () => ({ transactionId: 1, idTagInfo: { status: 'Accepted' } }),
			MeterValues: () => ({}),
			StopTransaction: () => ({ idTagInfo: { status: 'Accepted' } }),
		},
	});
	let sequence = 0;
	const simulator = createSimulator16({
		url: 'ws://in-memory/CP-1',
		transport: () => pair.client,
		clock,
		messageIds: () => `example-${String((sequence += 1))}`,
		station: {
			id: 'CP-1',
			vendor: 'Acme',
			model: 'AC-7',
			firmwareVersion: '1.0.0',
			connectorCount: 1,
			defaultIdTag: 'AABBCCDD',
		},
	});

	simulator.connect();
	pair.link.open();
	for (let attempt = 0; attempt < 20 && !simulator.isReady; attempt += 1) {
		await flushMicrotasks(5);
	}
	if (!simulator.isReady) throw new Error('The simulator did not boot');

	await simulator.authorize('A');
	await simulator.startChargingSession(1, 'A');
	await simulator.sendMeterValues(1);
	await simulator.stopTransaction(1);
	await csms.waitForIdle();

	const result = {
		ready: simulator.isReady,
		completedTransactions: simulator.getState().completedTransactions.length,
		calls: csms.calls.map((call) => call[2]),
	};
	simulator.dispose();
	return result;
}

if (process.argv[1] !== undefined && import.meta.url === pathToFileURL(process.argv[1]).href) {
	console.log(JSON.stringify(await run(), null, 2));
}
