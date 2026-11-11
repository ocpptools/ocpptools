// SPDX-License-Identifier: Apache-2.0
// SPDX-FileCopyrightText: 2026 Rodolfo Carrillo

import { pathToFileURL } from 'node:url';

import {
	createFrameFactory,
	createInMemoryTransportPair,
	createMockCsms,
} from '@ocpptools/testing';

export async function run() {
	const pair = createInMemoryTransportPair();
	const csms = createMockCsms({
		version: '2.0.1',
		transport: pair.server,
		handlers: {
			Heartbeat: () => ({ currentTime: '2026-01-01T00:00:00Z' }),
		},
	});
	const frames = createFrameFactory({ version: '2.0.1' });

	pair.link.open();
	pair.client.send(JSON.stringify(frames.call('Heartbeat', {})));
	await pair.link.flush();
	await csms.waitForIdle();

	const result = {
		calls: csms.calls.map((call) => call[2]),
		results: csms.results.map((result) => result[0]),
		errors: csms.errors.length,
	};
	pair.link.close();
	return result;
}

if (process.argv[1] !== undefined && import.meta.url === pathToFileURL(process.argv[1]).href) {
	console.log(JSON.stringify(await run(), null, 2));
}
