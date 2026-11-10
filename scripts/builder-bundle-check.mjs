// SPDX-License-Identifier: Apache-2.0
// SPDX-FileCopyrightText: 2026 Rodolfo Carrillo

// The builder must stay headless. Its bundle may contain only core,
// schema-utils, and builder code: no OCA schemas, Ajv, DOM, Node built-ins,
// Tailwind, or the website.

import { build } from 'esbuild';
import { existsSync, readFileSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const packageDir = join(root, 'packages/builder');
const distEntry = join(packageDir, 'dist/index.js');

if (!existsSync(distEntry)) {
	throw new Error('packages/builder/dist is missing; run pnpm build first');
}

const manifest = JSON.parse(readFileSync(join(packageDir, 'package.json'), 'utf8'));
for (const section of ['dependencies', 'peerDependencies', 'optionalDependencies']) {
	for (const name of ['@ocpptools/schemas', '@ocpptools/validator', 'ajv', 'ajv-formats']) {
		if (manifest[section]?.[name] !== undefined) {
			throw new Error(`The builder must not declare ${name} in ${section}`);
		}
	}
}

const result = await build({
	absWorkingDir: root,
	bundle: true,
	entryNames: 'entry',
	format: 'esm',
	logLevel: 'warning',
	metafile: true,
	outdir: '.cache/builder-bundle',
	platform: 'browser',
	stdin: {
		contents: `export { createBuilder } from ${JSON.stringify(distEntry)};`,
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

if (!inputs.some((path) => path.includes('packages/builder/dist/'))) {
	throw new Error('The builder bundle did not include the builder dist');
}
if (
	!inputs.some(
		(path) => path.includes('packages/core/dist/') || path.includes('packages/core/src/'),
	)
) {
	throw new Error('The builder bundle did not include core');
}
if (
	!inputs.some(
		(path) =>
			path.includes('packages/schema-utils/dist/') || path.includes('packages/schema-utils/src/'),
	)
) {
	throw new Error('The builder bundle did not include schema-utils');
}
for (const forbidden of ['packages/schemas/', 'packages/validator/', '/ajv/', 'ajv-formats']) {
	if (inputs.some((path) => path.includes(forbidden)) || output.includes(forbidden)) {
		throw new Error(`The builder bundle contains ${forbidden}`);
	}
}
for (const pattern of [
	/\bfrom\s*['"]node:/,
	/\bimport\s*\(\s*['"]node:/,
	/\bdocument\s*[.[]/,
	/\bwindow\s*[.[]/,
	/\bHTMLElement\b/,
	/\bnavigator\s*[.[]/,
	/\blocalStorage\s*[.[]/,
	/\bnew\s+WebSocket\b/,
]) {
	if (pattern.test(output)) {
		throw new Error(`The builder bundle uses a forbidden environment API: ${pattern}`);
	}
}

console.log('Builder bundle contains only core, schema-utils, and builder code.');
