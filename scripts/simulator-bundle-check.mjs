// SPDX-License-Identifier: Apache-2.0
// SPDX-FileCopyrightText: 2026 Rodolfo Carrillo

// The engine entries must not pull in the browser adapter, and the browser
// adapter must not pull in the engine. The full tree-shaking check is extended
// when the protocol profiles exist.

import { existsSync, readFileSync, readdirSync } from 'node:fs';
import { dirname, join, relative, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const packageDir = join(root, 'packages/simulator');
const distDir = join(packageDir, 'dist');
const entries = ['dist/index.js', 'dist/1.6.js', 'dist/2.0.1.js', 'dist/browser/index.js'];

for (const entry of entries) {
	if (!existsSync(join(packageDir, entry))) {
		throw new Error(`Missing simulator entry ${entry}; run pnpm build first`);
	}
}

function filesIn(directory) {
	const files = [];
	for (const entry of readdirSync(directory, { withFileTypes: true })) {
		const path = join(directory, entry.name);
		if (entry.isDirectory()) {
			files.push(...filesIn(path));
		} else if (entry.name.endsWith('.js')) {
			files.push(path);
		}
	}
	return files;
}

const browserPattern = /(?:from|import\s*\()\s*['"][^'"]*browser[^'"]*['"]/;
const enginePattern = /(?:from|import\s*\()\s*['"]\.\.\/(?:index|1\.6|2\.0\.1)\.js['"]/;

for (const file of filesIn(distDir)) {
	const text = readFileSync(file, 'utf8');
	const isBrowser = file.includes(`${join('dist', 'browser')}`);
	if (isBrowser) {
		if (enginePattern.test(text)) {
			throw new Error(`${relative(packageDir, file)} imports an engine entry`);
		}
	} else if (browserPattern.test(text) || text.includes('SIMULATOR_BROWSER_ENTRY')) {
		throw new Error(`${relative(packageDir, file)} imports the browser adapter`);
	}
}

console.log('Simulator bundle entries are separate and neither side imports the other.');
