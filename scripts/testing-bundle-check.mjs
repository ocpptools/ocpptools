// SPDX-License-Identifier: Apache-2.0
// SPDX-FileCopyrightText: 2026 Rodolfo Carrillo

// The testing package must stay neutral: only core and testing code, with no
// OCA schemas, Ajv, simulator, validator, ws, DOM, Node, or ambient time.

import { build } from 'esbuild';
import { existsSync, readFileSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const packageDir = join(root, 'packages/testing');
const distEntry = join(packageDir, 'dist/index.js');

if (!existsSync(distEntry)) {
	throw new Error('packages/testing/dist is missing; run pnpm build first');
}

const manifest = JSON.parse(readFileSync(join(packageDir, 'package.json'), 'utf8'));
const runtimeDependencies = Object.keys(manifest.dependencies ?? {}).sort();
if (runtimeDependencies.join(',') !== '@ocpptools/core') {
	throw new Error(
		`The testing package must depend only on @ocpptools/core: ${runtimeDependencies.join(', ')}`,
	);
}
for (const section of ['peerDependencies', 'optionalDependencies']) {
	const names = Object.keys(manifest[section] ?? {});
	if (names.length > 0) {
		throw new Error(`The testing package must not declare ${section}: ${names.join(', ')}`);
	}
}

const result = await build({
	absWorkingDir: root,
	bundle: true,
	entryNames: 'entry',
	format: 'esm',
	logLevel: 'warning',
	metafile: true,
	outdir: '.cache/testing-bundle',
	platform: 'browser',
	stdin: {
		contents: `export * from ${JSON.stringify(distEntry)};`,
		loader: 'js',
		resolveDir: packageDir,
		sourcefile: 'entry.js',
	},
	write: false,
});

const inputs = Object.keys(result.metafile.inputs).map((path) => path.replaceAll('\\', '/'));
const output = result.outputFiles
	.map((file) => Buffer.from(file.contents).toString('utf8'))
	.join('\n');

if (!inputs.some((path) => path.includes('packages/testing/dist/'))) {
	throw new Error('The testing bundle did not include the testing dist');
}
if (
	!inputs.some(
		(path) => path.includes('packages/core/dist/') || path.includes('packages/core/src/'),
	)
) {
	throw new Error('The testing bundle did not include core');
}
const allowedInput = /^packages\/(testing\/(dist\/|entry\.js$)|core\/(dist|src)\/)/;
for (const path of inputs) {
	if (!allowedInput.test(path)) {
		throw new Error(`The testing bundle contains an unexpected input: ${path}`);
	}
}
for (const forbidden of [
	'packages/simulator/',
	'packages/validator/',
	'packages/schemas/',
	'/ajv/',
	'ajv-formats',
	'/node_modules/ws/',
]) {
	if (inputs.some((path) => path.includes(forbidden)) || output.includes(forbidden)) {
		throw new Error(`The testing bundle contains ${forbidden}`);
	}
}
for (const pattern of [
	/\bfrom\s*['"]node:/,
	/\bimport\s*\(\s*['"]node:/,
	/\bfrom\s*['"]ws['"]/,
	/\bimport\s*\(\s*['"]ws['"]/,
	/\bdocument\s*[.[]/,
	/\bwindow\s*[.[]/,
	/\bHTMLElement\b/,
	/\bnavigator\s*[.[]/,
	/\blocalStorage\s*[.[]/,
	/\bnew\s+WebSocket\b/,
	/\bDate\.now\b/,
	/\bMath\.random\b/,
	/\bperformance\.now\b/,
	/\bprocess\./,
	/\bBuffer\./,
]) {
	if (pattern.test(output)) {
		throw new Error(`The testing bundle uses a forbidden environment API: ${pattern}`);
	}
}

console.log('Testing bundle contains only core and testing code.');
