// SPDX-License-Identifier: Apache-2.0
// SPDX-FileCopyrightText: 2026 Rodolfo Carrillo

import { readFile } from 'node:fs/promises';
import { createRequire } from 'node:module';
import { pathToFileURL } from 'node:url';
import { dirname, join } from 'node:path';

import { createBuilder } from '@ocpptools/builder';

const require = createRequire(import.meta.url);
const schemaRoot = join(
	dirname(require.resolve('@ocpptools/schemas/package.json')),
	'schemas',
	'2.0.1',
);

export async function run() {
	const builder = createBuilder({
		version: '2.0.1',
		schemas: {
			get: async (action, kind) => {
				if (kind !== 'request') return undefined;
				try {
					return JSON.parse(await readFile(join(schemaRoot, `${action}Request.json`), 'utf8'));
				} catch {
					return undefined;
				}
			},
		},
		messageIds: () => 'example-1',
	});
	const call = await builder.buildCall('BootNotification', {
		chargingStation: {
			model: 'AC-7',
			vendorName: 'Acme',
			firmwareVersion: '1.0.0',
		},
		reason: 'PowerUp',
	});
	const invalid = await builder.buildCall('BootNotification', {
		chargingStation: { model: 'AC-7' },
		reason: 'PowerUp',
	});
	return { call, invalid };
}

if (process.argv[1] !== undefined && import.meta.url === pathToFileURL(process.argv[1]).href) {
	console.log(JSON.stringify(await run(), null, 2));
}
