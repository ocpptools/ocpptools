// SPDX-License-Identifier: Apache-2.0
// SPDX-FileCopyrightText: 2026 Rodolfo Carrillo

import { copyFile, readFile, rm, writeFile } from 'node:fs/promises';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const here = dirname(fileURLToPath(import.meta.url));
const root = resolve(here, '..');
const target = process.cwd();
const mode = process.argv[2] ?? 'copy';
const variant = process.argv[3] ?? '';
const names = ['LICENSE', 'NOTICE'];

if (mode === 'copy') {
	for (const name of names) {
		if (name === 'NOTICE' && variant === 'no-schemas') {
			const source = await readFile(resolve(root, 'NOTICE'), 'utf8');
			const marker = '\nThe OCPP JSON Schemas';
			const index = source.indexOf(marker);
			const notice = index === -1 ? source : `${source.slice(0, index)}\n`;
			await writeFile(resolve(target, 'NOTICE'), notice, 'utf8');
			continue;
		}
		await copyFile(resolve(root, name), resolve(target, name));
	}
} else if (mode === 'clean') {
	for (const name of names) {
		await rm(resolve(target, name), { force: true });
	}
} else {
	throw new Error(`Unknown mode: ${mode}`);
}
