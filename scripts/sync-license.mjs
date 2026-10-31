// SPDX-License-Identifier: Apache-2.0
// SPDX-FileCopyrightText: 2026 Rodolfo Carrillo

import { copyFile, rm } from 'node:fs/promises';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const here = dirname(fileURLToPath(import.meta.url));
const root = resolve(here, '..');
const target = process.cwd();
const mode = process.argv[2] ?? 'copy';
const names = ['LICENSE', 'NOTICE'];

if (mode === 'copy') {
	for (const name of names) {
		await copyFile(resolve(root, name), resolve(target, name));
	}
} else if (mode === 'clean') {
	for (const name of names) {
		await rm(resolve(target, name), { force: true });
	}
} else {
	throw new Error(`Unknown mode: ${mode}`);
}
