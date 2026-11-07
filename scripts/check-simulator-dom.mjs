// SPDX-License-Identifier: Apache-2.0
// SPDX-FileCopyrightText: 2026 Rodolfo Carrillo

// The simulator engine must stay usable without a DOM or Node APIs. This check
// walks every built engine module and fails when a browser global or an ambient
// timer leaks into one of them. The browser adapter is excluded on purpose.

import { existsSync, readFileSync, readdirSync } from 'node:fs';
import { dirname, join, relative, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const packageDir = join(root, 'packages/simulator');
const distDir = join(packageDir, 'dist');

if (!existsSync(distDir)) {
	throw new Error('packages/simulator/dist is missing; run pnpm build first');
}

const forbidden = [
	['document', /\bdocument\s*[.[]/],
	['window', /\bwindow\s*[.[]/],
	['HTMLElement', /\bHTMLElement\b/],
	['navigator', /\bnavigator\s*[.[]/],
	['localStorage', /\blocalStorage\s*[.[]/],
	['WebSocket', /\bnew\s+WebSocket\b/],
	['setTimeout', /(^|[^.\w])setTimeout\s*\(/],
	['setInterval', /(^|[^.\w])setInterval\s*\(/],
	['Date.now', /\bDate\.now\s*\(/],
	['ambient Date', /\bnew\s+Date\s*\(\s*\)/],
	['Math.random', /\bMath\.random\s*\(/],
];

function stripComments(text) {
	return text.replace(/\/\*[\s\S]*?\*\//g, '').replace(/(^|[^:])\/\/.*$/gm, '$1');
}

function filesIn(directory) {
	const files = [];
	for (const entry of readdirSync(directory, { withFileTypes: true })) {
		const path = join(directory, entry.name);
		if (entry.isDirectory()) {
			if (entry.name !== 'browser') {
				files.push(...filesIn(path));
			}
		} else if (entry.name.endsWith('.js')) {
			files.push(path);
		}
	}
	return files;
}

for (const file of filesIn(distDir)) {
	const text = stripComments(readFileSync(file, 'utf8'));
	for (const [name, pattern] of forbidden) {
		if (pattern.test(text)) {
			throw new Error(`Simulator engine module ${relative(packageDir, file)} uses ${name}`);
		}
	}
}

console.log('Simulator engine is free of DOM, ambient time, and ambient randomness.');
