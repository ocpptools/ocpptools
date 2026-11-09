// SPDX-License-Identifier: Apache-2.0
// SPDX-FileCopyrightText: 2026 Rodolfo Carrillo

// The engine entries must not pull in the browser or Node adapters, the browser
// adapter must not pull in the engine or Node adapter, and the Node adapter must
// not pull in the engine or browser adapter. The full tree-shaking check is
// extended when the protocol profiles exist.

import { existsSync, readFileSync, readdirSync } from 'node:fs';
import { dirname, join, relative, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const packageDir = join(root, 'packages/simulator');
const distDir = join(packageDir, 'dist');
const entries = [
	'dist/index.js',
	'dist/1.6.js',
	'dist/2.0.1.js',
	'dist/browser/index.js',
	'dist/node/index.js',
];

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

function kindOf(file) {
	const relativeFile = relative(distDir, file).replaceAll('\\', '/');
	if (relativeFile.startsWith('browser/')) return 'browser';
	if (relativeFile.startsWith('node/')) return 'node';
	return 'engine';
}

function targetKindOf(file, specifier) {
	if (!specifier.startsWith('.')) return undefined;
	const target = relative(distDir, resolve(dirname(file), specifier)).replaceAll('\\', '/');
	if (target.startsWith('..')) return undefined;
	if (target.startsWith('browser/')) return 'browser';
	if (target.startsWith('node/')) return 'node';
	return 'engine';
}

const importPattern = /(?:from\s*|import\s*\(?\s*)['"]([^'"]+)['"]/g;
const engineEntryPattern = /(?:from|import\s*\()\s*['"]\.\.\/(?:index|1\.6|2\.0\.1)\.js['"]/;
const browserPattern = /(?:from|import\s*\()\s*['"][^'"]*browser[^'"]*['"]/;

for (const file of filesIn(distDir)) {
	const relativeFile = relative(packageDir, file).replaceAll('\\', '/');
	const text = readFileSync(file, 'utf8');
	const kind = kindOf(file);
	for (const match of text.matchAll(importPattern)) {
		const specifier = match[1];
		const target = targetKindOf(file, specifier);
		if (
			kind === 'browser' &&
			(target === 'node' ||
				specifier.startsWith('node:') ||
				specifier === '@ocpptools/simulator/node' ||
				specifier === '@ocpptools/simulator')
		) {
			throw new Error(`${relativeFile} imports the Node adapter or a Node built-in`);
		}
		if (kind === 'browser' && engineEntryPattern.test(text)) {
			throw new Error(`${relativeFile} imports an engine entry`);
		}
		if (kind === 'node' && (target === 'browser' || target === 'engine')) {
			throw new Error(`${relativeFile} imports an engine or browser module`);
		}
		if (
			kind === 'node' &&
			(specifier === '@ocpptools/simulator' || specifier.startsWith('@ocpptools/simulator/'))
		) {
			throw new Error(`${relativeFile} imports the simulator package root`);
		}
		if (
			kind === 'engine' &&
			(target === 'node' ||
				target === 'browser' ||
				specifier.startsWith('node:') ||
				specifier === '@ocpptools/simulator/node' ||
				specifier === '@ocpptools/simulator/browser')
		) {
			throw new Error(`${relativeFile} imports an adapter entry`);
		}
		if (
			kind === 'engine' &&
			(browserPattern.test(text) || text.includes('SIMULATOR_BROWSER_ENTRY'))
		) {
			throw new Error(`${relativeFile} imports the browser adapter`);
		}
	}
}

console.log(
	'Simulator engine, browser, and Node entries are separate and do not import each other.',
);
