// SPDX-License-Identifier: Apache-2.0
// SPDX-FileCopyrightText: 2026 Rodolfo Carrillo

// Fails when a published package drifts from the API inventory: missing
// entrypoints, types, files, repository directory, sideEffects, public access,
// or a target that does not exist after the build. It does not freeze the API.

import { existsSync, readFileSync, statSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..');

const packages = [
	{ directory: 'core', name: '@ocpptools/core', entrypoints: ['.'] },
	{ directory: 'schema-utils', name: '@ocpptools/schema-utils', entrypoints: ['.'] },
	{ directory: 'validator', name: '@ocpptools/validator', entrypoints: ['.'] },
	{
		directory: 'simulator',
		name: '@ocpptools/simulator',
		entrypoints: ['.', './1.6', './2.0.1', './browser', './node'],
	},
	{ directory: 'builder', name: '@ocpptools/builder', entrypoints: ['.'] },
	{ directory: 'testing', name: '@ocpptools/testing', entrypoints: ['.'] },
	{
		directory: 'schemas',
		name: '@ocpptools/schemas',
		entrypoints: ['./1.6/*', './2.0.1/*', './manifest.json'],
	},
	{ directory: 'cli', name: 'ocpptools', entrypoints: ['.'] },
];

const failures = [];

function fail(message) {
	failures.push(message);
}

for (const entry of packages) {
	const where = `packages/${entry.directory}`;
	const manifest = JSON.parse(readFileSync(join(root, where, 'package.json'), 'utf8'));
	if (manifest.name !== entry.name) {
		fail(`${where}: name is ${String(manifest.name)}, expected ${entry.name}`);
	}
	if (typeof manifest.version !== 'string' || !/^\d+\.\d+\.\d+/.test(manifest.version)) {
		fail(`${where}: missing or invalid version`);
	}
	if (manifest.private === true) {
		fail(`${where}: must not be private`);
	}
	if (manifest.publishConfig?.access !== 'public') {
		fail(`${where}: publishConfig.access must be public`);
	}
	if (manifest.sideEffects !== false) {
		fail(`${where}: sideEffects must be false`);
	}
	if (!Array.isArray(manifest.files) || !manifest.files.includes('NOTICE')) {
		fail(`${where}: files must include NOTICE`);
	}
	if (manifest.exports === undefined || typeof manifest.exports !== 'object') {
		fail(`${where}: missing exports`);
		continue;
	}

	const actual = Object.keys(manifest.exports).filter((key) => key !== './package.json');
	for (const entrypoint of entry.entrypoints) {
		if (!actual.includes(entrypoint)) fail(`${where}: missing export ${entrypoint}`);
	}
	for (const entrypoint of actual) {
		if (!entry.entrypoints.includes(entrypoint)) {
			fail(`${where}: unexpected export ${entrypoint}`);
		}
	}

	if (entry.directory === 'schemas') {
		const expected = new Map([
			['./1.6/*', './schemas/1.6/*'],
			['./2.0.1/*', './schemas/2.0.1/*'],
			['./manifest.json', './manifest.json'],
		]);
		for (const [subpath, target] of expected) {
			if (manifest.exports[subpath] !== target) {
				fail(`${where}: export ${subpath} must be ${target}`);
			}
		}
		for (const directory of ['schemas/1.6', 'schemas/2.0.1']) {
			if (!existsSync(join(root, where, directory))) fail(`${where}: missing ${directory}`);
		}
		if (!existsSync(join(root, where, 'manifest.json'))) {
			fail(`${where}: missing manifest.json`);
		}
	} else {
		for (const [subpath, target] of Object.entries(manifest.exports)) {
			if (subpath === './package.json') continue;
			if (target === null || typeof target !== 'object') {
				fail(`${where}: export ${subpath} must be a conditions object`);
				continue;
			}
			if (typeof target.types !== 'string' || typeof target.import !== 'string') {
				fail(`${where}: export ${subpath} needs types and import`);
				continue;
			}
			for (const condition of ['types', 'import']) {
				const relative = target[condition].replace(/^\.\//, '');
				const absolute = join(root, where, relative);
				if (!existsSync(absolute)) {
					fail(`${where}: export ${subpath} ${condition} target ${target[condition]} is missing`);
				} else if (!statSync(absolute).isFile()) {
					fail(`${where}: export ${subpath} ${condition} target is not a file`);
				}
			}
		}
	}

	if (!existsSync(join(root, where, 'NOTICE'))) {
		fail(`${where}: NOTICE is missing`);
	}
	const requiredFiles = entry.directory === 'schemas' ? ['schemas', 'manifest.json'] : ['dist'];
	for (const file of requiredFiles) {
		if (!Array.isArray(manifest.files) || !manifest.files.includes(file)) {
			fail(`${where}: files must include ${file}`);
		}
	}

	if (entry.directory === 'cli') {
		const bin = manifest.bin?.ocpptools;
		const absolute =
			typeof bin === 'string'
				? join(root, where, bin.replace(/^\.\//, ''))
				: join(root, where, 'missing');
		if (typeof bin !== 'string' || !existsSync(absolute) || !statSync(absolute).isFile()) {
			fail(`${where}: bin.ocpptools target is missing`);
		}
	}
}

if (failures.length > 0) {
	for (const failure of failures) console.error(`API inventory: ${failure}`);
	process.exit(1);
}

console.log(`API inventory: ${String(packages.length)} packages checked.`);
