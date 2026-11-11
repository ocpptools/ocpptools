// SPDX-License-Identifier: Apache-2.0
// SPDX-FileCopyrightText: 2026 Rodolfo Carrillo

import { readFile, readdir } from 'node:fs/promises';
import { createRequire } from 'node:module';
import { pathToFileURL } from 'node:url';
import { dirname, join } from 'node:path';

import { createSchemaRegistry, createValidator } from '@ocpptools/validator';

const require = createRequire(import.meta.url);
const schemaRoot = join(
	dirname(require.resolve('@ocpptools/schemas/package.json')),
	'schemas',
	'2.0.1',
);

async function validator() {
	const files = await readdir(schemaRoot);
	const schemas = createSchemaRegistry({
		version: '2.0.1',
		files,
		load: async (fileName) => JSON.parse(await readFile(join(schemaRoot, fileName), 'utf8')),
	});
	return createValidator({ version: '2.0.1', schemas });
}

const validFrame = JSON.stringify([
	2,
	'example-1',
	'BootNotification',
	{
		chargingStation: {
			model: 'AC-7',
			vendorName: 'Acme',
			firmwareVersion: '1.0.0',
		},
		reason: 'PowerUp',
	},
]);

const invalidFrame = JSON.stringify([
	2,
	'example-2',
	'BootNotification',
	{ chargingStation: { model: 'AC-7' }, reason: 'PowerUp' },
]);

export async function run() {
	const validate = await validator();
	return {
		valid: await validate.validateFrame(validFrame),
		invalid: await validate.validateFrame(invalidFrame),
	};
}

if (process.argv[1] !== undefined && import.meta.url === pathToFileURL(process.argv[1]).href) {
	const result = await run();
	console.log(JSON.stringify(result, null, 2));
}
