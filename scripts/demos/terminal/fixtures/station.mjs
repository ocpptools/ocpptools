// SPDX-License-Identifier: Apache-2.0
// SPDX-FileCopyrightText: 2026 Rodolfo Carrillo

// Demo script for docs/assets/simulator-code.gif: drives a simulated OCPP
// 2.0.1 station from code against the synthetic CSMS and prints its events.

import { createNodeWebSocketTransportFactory, nodeClock } from '@ocpptools/simulator/node';
import { Simulator201 } from '@ocpptools/simulator/2.0.1';

const simulator = new Simulator201({
	url: 'ws://127.0.0.1:9000/CP001',
	transport: createNodeWebSocketTransportFactory(),
	clock: nodeClock,
	station: { id: 'CP001', vendorName: 'Acme', model: 'AC-22', firmwareVersion: '2.0.0' },
});

simulator.on('connection', (event) => console.log(`connection  ${event.state}`));
simulator.on('boot', (event) => console.log(`boot        ${event.status}`));
simulator.on('frame', (event) => {
	if (event.direction === 'sent' && event.messageType === 'CALL') {
		console.log(`sent        ${event.action ?? ''}`);
	}
});

const connected = new Promise((resolve) => {
	const unsubscribe = simulator.on('connection', (event) => {
		if (event.state === 'connected') {
			unsubscribe();
			resolve(undefined);
		}
	});
});
simulator.connect();
await connected;

const result = await simulator.runScenario([
	{ type: 'boot' },
	{ type: 'start', idToken: 'AABBCCDD' },
	{ type: 'meter' },
	{ type: 'stop', reason: 'Local' },
]).done;
console.log(`scenario    ${result.status}`);
simulator.dispose();
