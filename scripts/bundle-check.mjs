// SPDX-License-Identifier: Apache-2.0
// SPDX-FileCopyrightText: 2026 Rodolfo Carrillo

// Verifies that the validator does not pull all OCPP schemas into a consumer
// bundle. Entry A imports only the validator. Entry B maps every schema to a
// literal dynamic import and validates Heartbeat. The entry chunk must contain
// no schema, and every schema must live in its own chunk.

import { build } from 'esbuild';
import { existsSync, mkdtempSync, mkdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { basename, dirname, join, resolve } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const validatorDir = join(root, 'packages/validator');
const schemasDir = join(root, 'packages/schemas');
let cacheDir;
const manifest = JSON.parse(readFileSync(join(schemasDir, 'manifest.json'), 'utf8'));
const validatorPackage = JSON.parse(readFileSync(join(validatorDir, 'package.json'), 'utf8'));
const paths = Object.keys(manifest.files).sort();
const ids = new Map();

if (!existsSync(join(validatorDir, 'dist/index.js'))) {
	throw new Error('packages/validator/dist is missing; run pnpm build first');
}
if (Object.keys(validatorPackage.peerDependencies ?? {}).length > 0) {
	throw new Error('The validator must not declare peerDependencies for the size check');
}

if (paths.length !== 184) {
	throw new Error(`Expected 184 schemas, found ${String(paths.length)}`);
}

for (const path of paths) {
	const schema = JSON.parse(readFileSync(join(schemasDir, 'schemas', path), 'utf8'));
	const id = schema.$id ?? schema.id;
	if (typeof id !== 'string' || id === '') {
		throw new Error(`Schema ${path} has no id`);
	}
	if ([...ids.values()].includes(id)) {
		throw new Error(`Duplicate schema id ${id}`);
	}
	ids.set(path, id);
}

const heartbeatId = ids.get('2.0.1/HeartbeatRequest.json');
if (typeof heartbeatId !== 'string' || heartbeatId === '') {
	throw new Error('HeartbeatRequest has no id');
}

const schemaIds = [...ids.values()];
const loaderEntries = paths
	.map(
		(path) =>
			`${JSON.stringify(path)}: () => import(${JSON.stringify(`@ocpptools/schemas/${path}`)})`,
	)
	.join(',\n');

const entryA = `
import { createValidator } from './dist/index.js';

export const create = createValidator;
`;

const entryB = `
import { createSchemaRegistry, createValidator } from './dist/index.js';

const loaders = {
${loaderEntries}
};
const files = Object.keys(loaders).filter((path) => path.startsWith('2.0.1/'));

export async function run() {
	const loaded = [];
	const schemas = createSchemaRegistry({
		version: '2.0.1',
		files,
		load: async (fileName) => {
			loaded.push(fileName);
			const loader = loaders['2.0.1/' + fileName];
			if (loader === undefined) return undefined;
			const module = await loader();
			return module.default;
		},
	});
	const validator = createValidator({ version: '2.0.1', schemas });
	const result = await validator.validateFrame([2, 'id', 'Heartbeat', {}]);
	return { loaded, result };
}
`;

async function bundle(source, name) {
	const outdir = join(cacheDir, name);
	rmSync(outdir, { recursive: true, force: true });
	const result = await build({
		absWorkingDir: root,
		bundle: true,
		entryNames: 'entry',
		format: 'esm',
		logLevel: 'warning',
		metafile: true,
		outdir,
		platform: 'browser',
		splitting: true,
		stdin: {
			contents: source,
			loader: 'js',
			resolveDir: validatorDir,
			sourcefile: 'entry.js',
		},
		tsconfigRaw: '{}',
		write: false,
	});
	if (result.warnings.length > 0) {
		throw new Error(`esbuild warnings: ${JSON.stringify(result.warnings)}`);
	}
	return { ...result, outdir };
}

function outputMap(result) {
	const filesByPath = new Map(
		result.outputFiles.map((file) => [resolve(file.path), file.contents]),
	);
	return Object.entries(result.metafile.outputs).map(([path, info]) => {
		const absolute = resolve(root, path);
		const contents = filesByPath.get(absolute);
		if (contents === undefined) {
			throw new Error(`Bundle output ${path} has no contents`);
		}
		return {
			path: absolute,
			info,
			text: Buffer.from(contents).toString('utf8'),
		};
	});
}

function inputsOf(result) {
	return Object.keys(result.metafile.inputs).map((path) => path.replaceAll('\\', '/'));
}

function idsIn(text) {
	return schemaIds.filter((id) => text.includes(id));
}

try {
	cacheDir = mkdtempSync(join(tmpdir(), 'ocpptools-bundle-'));
	const a = await bundle(entryA, 'a');
	const aInputs = inputsOf(a);
	const aOutputs = outputMap(a);
	const aText = aOutputs.map((output) => output.text).join('\n');
	if (!aInputs.some((path) => path.includes('packages/validator/dist/index.js'))) {
		throw new Error('Entry A did not include the validator dist');
	}
	if (!aInputs.some((path) => path.includes('packages/core/dist/index.js'))) {
		throw new Error('Entry A did not include core dist');
	}
	if (!aInputs.some((path) => path.includes('packages/schema-utils/dist/index.js'))) {
		throw new Error('Entry A did not include schema-utils dist');
	}
	if (!aInputs.some((path) => path.includes('/ajv/'))) {
		throw new Error('Entry A did not include Ajv');
	}
	if (!aInputs.some((path) => path.includes('/ajv-formats/'))) {
		throw new Error('Entry A did not include ajv-formats');
	}
	if (aInputs.some((path) => path.includes('packages/schemas/schemas/'))) {
		throw new Error('Entry A imported schemas');
	}
	if (idsIn(aText).length !== 0) {
		throw new Error('Entry A contains OCA schema ids');
	}

	const b = await bundle(entryB, 'b');
	const bInputs = inputsOf(b);
	const bOutputs = outputMap(b);
	const schemaPrefix = 'packages/schemas/schemas/';
	const schemaInputs = new Set(
		bInputs
			.filter((path) => path.includes(schemaPrefix))
			.map((path) => path.slice(path.indexOf(schemaPrefix) + schemaPrefix.length)),
	);
	const missingInputs = paths.filter((path) => !schemaInputs.has(path));
	const extraInputs = [...schemaInputs].filter((path) => !paths.includes(path));
	if (missingInputs.length > 0 || extraInputs.length > 0) {
		throw new Error(
			`Schema inputs differ. Missing: ${missingInputs.join(', ') || 'none'}; extra: ${
				extraInputs.join(', ') || 'none'
			}`,
		);
	}
	const entryOutput = bOutputs.find((output) => basename(output.path) === 'entry.js');
	if (entryOutput === undefined) {
		throw new Error('Entry B has no entry chunk');
	}
	const entryIds = idsIn(entryOutput.text);
	if (entryIds.length !== 0) {
		throw new Error(`The entry chunk contains OCA schema ids: ${entryIds.join(', ')}`);
	}
	const schemaChunks = bOutputs.filter(
		(output) =>
			output.path !== entryOutput.path &&
			Object.keys(output.info.inputs).some((path) => path.includes(schemaPrefix)),
	);
	if (schemaChunks.length !== paths.length) {
		throw new Error(
			`Expected ${String(paths.length)} schema chunks, found ${String(schemaChunks.length)}`,
		);
	}
	const seenPaths = new Set();
	for (const chunk of schemaChunks) {
		const chunkPaths = Object.keys(chunk.info.inputs)
			.map((path) => path.replaceAll('\\', '/'))
			.filter((path) => path.includes(schemaPrefix))
			.map((path) => path.slice(path.indexOf(schemaPrefix) + schemaPrefix.length));
		if (chunkPaths.length !== 1) {
			throw new Error(
				`Chunk ${basename(chunk.path)} contains ${String(chunkPaths.length)} schema inputs`,
			);
		}
		const schemaPath = chunkPaths[0];
		const schemaId = ids.get(schemaPath);
		if (schemaId === undefined || !chunk.text.includes(schemaId)) {
			throw new Error(`Chunk ${basename(chunk.path)} is missing ${schemaPath}`);
		}
		if (seenPaths.has(schemaPath)) {
			throw new Error(`Schema ${schemaPath} appears in more than one chunk`);
		}
		seenPaths.add(schemaPath);
	}
	if (seenPaths.size !== paths.length) {
		throw new Error(`The bundle has ${String(seenPaths.size)} distinct schema paths`);
	}
	if (!seenPaths.has('2.0.1/HeartbeatRequest.json')) {
		throw new Error('The HeartbeatRequest schema is missing from the bundle');
	}

	for (const output of bOutputs) {
		const target = join(output.path);
		mkdirSync(dirname(target), { recursive: true });
		writeFileSync(target, output.text);
	}
	const module = await import(`${pathToFileURL(entryOutput.path).href}?bundle-check`);
	const { loaded, result } = await module.run();
	if (JSON.stringify(loaded) !== JSON.stringify(['HeartbeatRequest.json'])) {
		throw new Error(`The bundled loader requested ${JSON.stringify(loaded)}`);
	}
	if (result.status !== 'valid') {
		throw new Error(
			`The bundled validator returned ${String(result.status)}: ${JSON.stringify(result.issues)}`,
		);
	}
	console.log(
		`Bundle check passed: entry has 0 schema ids, ${String(paths.length)} schema chunks, Heartbeat valid.`,
	);
} finally {
	if (cacheDir !== undefined) {
		rmSync(cacheDir, { recursive: true, force: true });
	}
}
