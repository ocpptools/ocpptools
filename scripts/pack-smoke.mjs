// SPDX-License-Identifier: Apache-2.0
// SPDX-FileCopyrightText: 2026 Rodolfo Carrillo

// Packs each package listed below, installs the tarball into a throwaway
// consumer project, and checks what a real user would get: the allowed files
// only, the expected public exports, and a working round trip. A package
// without dependencies is unpacked into `node_modules`; one with dependencies
// is installed with pnpm, with its workspace dependencies packed too and used
// instead of the versions on npm. Run `pnpm build` first, because the tarballs
// ship `dist/`. Pass package directory names to check only those, for example
// `node scripts/pack-smoke.mjs core`.

import { execFileSync } from 'node:child_process';
import { mkdir, readdir, rm, writeFile } from 'node:fs/promises';
import { basename, dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..');
// Inside the repository (`.cache/` is gitignored) so every path stays relative
// and free of spaces, which tar and the Windows shell both need.
const cacheDir = '.cache/pack-smoke';

const defaultAllowedFile = /^package\/(package\.json|README\.md|LICENSE|NOTICE|dist\/.+)$/;
const defaultRequiredFiles = [
	'package.json',
	'README.md',
	'LICENSE',
	'NOTICE',
	'dist/index.js',
	'dist/index.d.ts',
];

// `exports` is the whole runtime API, so adding or removing an export fails
// here until it is listed on purpose. `behavior` runs in the consumer project
// with the package imported as `pkg`. A package of data files sets
// `allowedFile`, `requiredFiles`, and its own `consumer` source instead. A
// package that depends on other workspace packages lists their directories in
// `workspaceDependencies`.
const packages = [
	{
		directory: 'core',
		name: '@ocpptools/core',
		exports: [
			'MAX_MESSAGE_ID_LENGTH',
			'MESSAGE_TYPE',
			'OCPP_ERROR_CODES',
			'OCPP_SUBPROTOCOLS',
			'OCPP_VERSIONS',
			'createMessageIdGenerator',
			'inspectFrame',
			'isCall',
			'isCallError',
			'isCallResult',
			'isErrorCode',
			'parseFrame',
			'serializeFrame',
		],
		behavior: `
const text = '[2,"19223201","BootNotification",{"chargePointVendor":"Acme"}]';
const parsed = pkg.parseFrame(text);
assert.ok(parsed.ok);
assert.ok(pkg.isCall(parsed.value));
const serialized = pkg.serializeFrame(parsed.value);
assert.deepEqual(serialized, { ok: true, value: text });

assert.equal(pkg.parseFrame('[9]').error.kind, 'unknown-message-type');
assert.ok(pkg.isErrorCode('1.6', 'FormationViolation'));
assert.ok(!pkg.isErrorCode('2.0.1', 'FormationViolation'));
assert.equal(pkg.createMessageIdGenerator()().length, 36);

assert.deepEqual(pkg.inspectFrame([2, 'id', 'Heartbeat', {}]), { messageType: 2, messageId: 'id', issues: [] });
assert.deepEqual(
	pkg.inspectFrame([2, '', '', []], { version: '2.0.1' }).issues.map((issue) => issue.code),
	['invalid-message-id', 'invalid-action', 'invalid-payload'],
);
`,
	},
	{
		directory: 'schema-utils',
		name: '@ocpptools/schema-utils',
		exports: [
			'applyDefaults',
			'createEmptyPayload',
			'detectDraft',
			'getFields',
			'normalizeSchema',
			'resolveRefs',
		],
		behavior: `
const legacy = { id: 'urn:example:smoke', exclusiveMinimum: true, minimum: 1 };
assert.equal(pkg.detectDraft({ $schema: 'http://json-schema.org/draft-04/schema#' }), 'draft-04');
assert.deepEqual(pkg.normalizeSchema({ $schema: 'http://json-schema.org/draft-04/schema#', ...legacy }), {
	ok: true,
	value: {
		schema: { $schema: 'http://json-schema.org/draft-07/schema#', $id: 'urn:example:smoke', exclusiveMinimum: 1 },
		draft: 'draft-04',
		warnings: [],
	},
});
assert.equal(pkg.normalizeSchema(undefined).error.kind, 'invalid-schema');

const refs = pkg.resolveRefs({
	definitions: { Name: { type: 'string' } },
	properties: { name: { $ref: '#/definitions/Name' } },
});
assert.deepEqual(refs, {
	ok: true,
	value: {
		definitions: { Name: { type: 'string' } },
		properties: { name: { type: 'string' } },
	},
});
assert.equal(pkg.resolveRefs({ $ref: '#' }).error.kind, 'circular-ref');
assert.equal(pkg.resolveRefs({ $ref: 'other.json' }).error.kind, 'external-ref');

const root = pkg.getFields({
	type: 'object',
	properties: { name: { type: 'string', maxLength: 5 }, tags: { type: 'array', items: { type: 'string' } } },
	required: ['name'],
});
assert.equal(root.kind, 'object');
assert.deepEqual(root.children.map((field) => [field.name, field.kind, field.required]), [
	['name', 'string', true],
	['tags', 'array', false],
]);
assert.equal(root.children[0].maxLength, 5);
assert.deepEqual(root.children[1].item.path, ['tags', 0]);

const payloadSchema = {
	type: 'object',
	properties: {
		name: { type: 'string', default: 'unnamed' },
		mode: { type: 'string', enum: ['fast', 'slow'] },
		note: { type: 'string', default: 'none' },
	},
	required: ['name', 'mode'],
};
assert.deepEqual(pkg.createEmptyPayload(payloadSchema), { name: 'unnamed', mode: 'fast' });
assert.deepEqual(pkg.applyDefaults(payloadSchema, { mode: 'slow' }), {
	ok: true,
	value: { mode: 'slow', name: 'unnamed', note: 'none' },
});
assert.equal(pkg.applyDefaults(payloadSchema, undefined).error.kind, 'invalid-value');
`,
	},
	{
		directory: 'schemas',
		name: '@ocpptools/schemas',
		allowedFile:
			/^package\/(package\.json|README\.md|LICENSE|NOTICE|SOURCES\.md|manifest\.json|LICENSE-CC-BY-ND-4\.0\.txt|schemas\/(1\.6|2\.0\.1)\/[A-Za-z0-9]+\.json)$/,
		requiredFiles: [
			'package.json',
			'README.md',
			'LICENSE',
			'NOTICE',
			'SOURCES.md',
			'manifest.json',
			'LICENSE-CC-BY-ND-4.0.txt',
			'schemas/1.6/Authorize.json',
			'schemas/2.0.1/AuthorizeRequest.json',
		],
		// The OCA JSON Schemas must reach users byte for byte, with the license.
		consumer: `
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { readFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import authorize16 from '@ocpptools/schemas/1.6/Authorize.json' with { type: 'json' };
import authorize201 from '@ocpptools/schemas/2.0.1/AuthorizeRequest.json' with { type: 'json' };

const require = createRequire(import.meta.url);
const manifest = JSON.parse(readFileSync(require.resolve('@ocpptools/schemas/manifest.json'), 'utf8'));
const paths = Object.keys(manifest.files);
assert.equal(paths.length, 184);
for (const path of paths) {
	const bytes = readFileSync(require.resolve('@ocpptools/schemas/' + path));
	assert.equal(createHash('sha256').update(bytes).digest('hex'), manifest.files[path], path);
}
assert.equal(typeof authorize16.id, 'string');
assert.equal(typeof authorize201.$id, 'string');

const license = readFileSync(
	new URL('./node_modules/@ocpptools/schemas/LICENSE-CC-BY-ND-4.0.txt', import.meta.url),
	'utf8',
);
assert.ok(license.startsWith('Attribution-NoDerivatives 4.0 International'));
`,
	},
	{
		directory: 'validator',
		name: '@ocpptools/validator',
		workspaceDependencies: ['core', 'schema-utils'],
		exports: ['SchemaLoadError', 'createSchemaRegistry', 'createValidator', 'schemaFileName'],
		behavior: `
assert.equal(pkg.schemaFileName('1.6', 'Heartbeat', 'request'), 'Heartbeat.json');
assert.equal(pkg.schemaFileName('2.0.1', 'Heartbeat', 'request'), 'HeartbeatRequest.json');
assert.equal(pkg.schemaFileName('2.0.1', '../x', 'response'), undefined);
const requestSchema = {
	type: 'object',
	required: ['currentTime'],
	additionalProperties: false,
	properties: { currentTime: { type: 'string', format: 'date-time' } },
};
const responseSchema = {
	type: 'object',
	required: ['status'],
	additionalProperties: false,
	properties: { status: { type: 'string' } },
};
const validator = pkg.createValidator({
	version: '2.0.1',
	schemas: {
		get: (action, kind) =>
			action === 'Heartbeat'
				? kind === 'request'
					? requestSchema
					: kind === 'response'
						? responseSchema
						: undefined
				: undefined,
	},
});
assert.equal(validator.version, '2.0.1');
const accepted = await validator.validatePayload('Heartbeat', 'request', {
	currentTime: '2026-01-01T00:00:00Z',
});
assert.equal(accepted.status, 'valid');
const rejected = await validator.validatePayload('Heartbeat', 'request', { currentTime: 1 });
assert.equal(rejected.status, 'invalid-payload');
assert.equal(rejected.issues[0].keyword, 'type');
assert.equal((await validator.validatePayload('Nope', 'request', {})).status, 'unknown-action');
const call = await validator.validateFrame([
	2,
	'id-1',
	'Heartbeat',
	{ currentTime: '2026-01-01T00:00:00Z' },
]);
assert.equal(call.status, 'valid');
assert.equal(call.messageType, 2);
const badCall = await validator.validateFrame([2, 'id-1', 'Heartbeat', { currentTime: 1 }]);
assert.equal(badCall.status, 'invalid-payload');
assert.deepEqual(badCall.issues[0].path, [3, 'currentTime']);
const unchecked = await validator.validateFrame([3, 'id-1', {}]);
assert.equal(unchecked.status, 'valid');
assert.equal(unchecked.warnings[0].code, 'unchecked-result');
const checked = await validator.validateFrame([3, 'id-2', { status: 'ok' }], {
	requestAction: 'Heartbeat',
});
assert.equal(checked.status, 'valid');
assert.equal(checked.action, 'Heartbeat');
assert.equal(
	(await validator.validateFrame([4, 'id-3', 'GenericError', 'text', {}])).status,
	'valid',
);
const badCallError = await validator.validateFrame([4, 'id-4', 'Nope', 'text', {}]);
assert.equal(badCallError.status, 'invalid-frame');
assert.equal(badCallError.action, undefined);
assert.equal((await validator.validateFrame('{')).status, 'invalid-frame');
const unavailable = pkg.createValidator({
	version: '1.6',
	schemas: {
		get: () => {
			throw new Error('boom');
		},
	},
});
const failed = await unavailable.validatePayload('Heartbeat', 'request', {});
assert.equal(failed.status, 'schema-missing');
assert.equal(failed.issues[0].code, 'schema-load-failed');
const broken = pkg.createValidator({
	version: '2.0.1',
	schemas: { get: () => null },
});
const invalidSchema = await broken.validatePayload('Heartbeat', 'request', {});
assert.equal(invalidSchema.status, 'schema-missing');
assert.equal(invalidSchema.issues[0].code, 'schema-invalid');
const moduleLike = pkg.createValidator({
	version: '2.0.1',
	schemas: {
		get: () => ({ [Symbol.toStringTag]: 'Module', default: { type: 'object' } }),
	},
});
const moduleResult = await moduleLike.validatePayload('Heartbeat', 'request', {});
assert.equal(moduleResult.status, 'schema-missing');
assert.equal(moduleResult.issues[0].code, 'schema-invalid');
const loaded = [];
const registry = pkg.createSchemaRegistry({
	version: '2.0.1',
	files: ['2.0.1/HeartbeatRequest.json'],
	load: async (fileName) => {
		loaded.push(fileName);
		return { type: 'object' };
	},
});
assert.deepEqual(await registry.get('Heartbeat', 'request'), { type: 'object' });
assert.equal(registry.get('Heartbeat', 'response'), undefined);
assert.deepEqual(loaded, ['HeartbeatRequest.json']);
const failing = pkg.createSchemaRegistry({
	version: '1.6',
	load: () => {
		throw new Error('boom');
	},
});
await assert.rejects(Promise.resolve(failing.get('Heartbeat', 'request')), pkg.SchemaLoadError);

// Every dependency is installed, and the workspace ones are the local tarballs:
// the published @ocpptools/core 0.1.1 has no inspectFrame.
const { createRequire } = await import('node:module');
const { dirname, join } = await import('node:path');
const { pathToFileURL } = await import('node:url');
const require = createRequire(import.meta.resolve('@ocpptools/validator'));
require.resolve('ajv');
require.resolve('ajv-formats');
const coreDirectory = dirname(require.resolve('@ocpptools/core/package.json'));
const core = await import(pathToFileURL(join(coreDirectory, 'dist/index.js')).href);
assert.equal(typeof core.inspectFrame, 'function');
const schemaUtilsDirectory = dirname(require.resolve('@ocpptools/schema-utils/package.json'));
const schemaUtils = await import(pathToFileURL(join(schemaUtilsDirectory, 'dist/index.js')).href);
assert.equal(typeof schemaUtils.normalizeSchema, 'function');
`,
	},
	{
		directory: 'simulator',
		name: '@ocpptools/simulator',
		workspaceDependencies: ['core'],
		exports: [
			'Connection',
			'EngineBase',
			'EventEmitter',
			'History',
			'Metrics',
			'OfflineQueue',
			'Rpc',
			'SIMULATOR_NAME',
			'Scheduler',
			'SimulatorCallError',
			'SimulatorError',
			'SimulatorValidationError',
			'defaultRandom',
			'errorSnapshot',
		],
		requiredFiles: [
			'package.json',
			'README.md',
			'LICENSE',
			'NOTICE',
			'dist/index.js',
			'dist/index.d.ts',
			'dist/1.6.js',
			'dist/1.6.d.ts',
			'dist/2.0.1.js',
			'dist/2.0.1.d.ts',
			'dist/browser/index.js',
			'dist/browser/index.d.ts',
		],
		behavior: `
assert.equal(pkg.SIMULATOR_NAME, '@ocpptools/simulator');
const s16 = await import('@ocpptools/simulator/1.6');
const s201 = await import('@ocpptools/simulator/2.0.1');
const browser = await import('@ocpptools/simulator/browser');
assert.equal(s16.SIMULATOR_PROTOCOL_VERSION, '1.6');
assert.equal(s201.SIMULATOR_PROTOCOL_VERSION, '2.0.1');
assert.equal(typeof s16.Simulator16, 'function');
assert.equal(typeof s201.Simulator201, 'function');
assert.equal(typeof browser.createWebSocketTransportFactory, 'function');
assert.equal(typeof browser.browserClock.now, 'function');
assert.equal(typeof browser.createWebStorage, 'function');
const { readFileSync } = await import('node:fs');
const { createRequire } = await import('node:module');
const require = createRequire(import.meta.url);
const manifest = JSON.parse(readFileSync(require.resolve('@ocpptools/simulator/package.json'), 'utf8'));
assert.deepEqual(Object.keys(manifest.exports).sort(), ['.', './1.6', './2.0.1', './browser', './package.json']);
`,
	},
];

/**
 * @param {string} command
 * @param {string[]} args
 * @param {string} [cwd]
 */
function run(command, args, cwd = root) {
	return execFileSync(command, args, {
		cwd,
		encoding: 'utf8',
		// `pnpm` is a .cmd shim on Windows, which Node only runs through a shell.
		shell: process.platform === 'win32' && command === 'pnpm',
	});
}

/**
 * Packs a package into an empty directory and returns the tarball's path.
 *
 * @param {string} name
 * @param {string} destination
 */
async function pack(name, destination) {
	await mkdir(resolve(root, destination), { recursive: true });
	run('pnpm', ['--filter', name, 'pack', '--pack-destination', destination]);
	const tarballs = (await readdir(resolve(root, destination))).filter((file) =>
		file.endsWith('.tgz'),
	);
	if (tarballs.length !== 1) {
		throw new Error(`Expected one tarball in ${destination}, found ${String(tarballs.length)}`);
	}
	return `${destination}/${tarballs[0]}`;
}

/**
 * Installs the tarball and its dependencies with pnpm. The consumer has its own
 * `pnpm-workspace.yaml`, so pnpm does not treat it as part of this workspace,
 * and its `overrides` replace each workspace dependency with a local tarball.
 *
 * @param {(typeof packages)[number]} pkg
 * @param {string} tarball
 * @param {string} workDir
 */
async function install(pkg, tarball, workDir) {
	const overrides = [];
	for (const directory of pkg.workspaceDependencies ?? []) {
		const dependency = packages.find((entry) => entry.directory === directory);
		if (dependency === undefined) {
			throw new Error(`Unknown workspace dependency of ${pkg.name}: ${directory}`);
		}
		const dependencyTarball = await pack(dependency.name, `${workDir}/dependencies/${directory}`);
		overrides.push(
			`  ${JSON.stringify(dependency.name)}: ${JSON.stringify(`file:../dependencies/${directory}/${basename(dependencyTarball)}`)}`,
		);
	}
	const consumerDir = `${workDir}/consumer`;
	await mkdir(resolve(root, consumerDir), { recursive: true });
	await writeFile(
		resolve(root, consumerDir, 'package.json'),
		`${JSON.stringify({ type: 'module', private: true, dependencies: { [pkg.name]: `file:../${basename(tarball)}` } })}\n`,
	);
	await writeFile(
		resolve(root, consumerDir, 'pnpm-workspace.yaml'),
		`overrides:\n${overrides.join('\n')}\n`,
	);
	run('pnpm', ['install', '--prefer-offline', '--reporter=silent'], resolve(root, consumerDir));
}

/** @param {(typeof packages)[number]} pkg */
async function check(pkg) {
	const workDir = `${cacheDir}/${pkg.directory}`;

	await rm(resolve(root, workDir), { recursive: true, force: true });
	const tarball = await pack(pkg.name, workDir);

	const entries = run('tar', ['-tzf', tarball])
		.split('\n')
		.map((line) => line.trim())
		.filter((line) => line !== '' && !line.endsWith('/'));
	const allowedFile = pkg.allowedFile ?? defaultAllowedFile;
	const unexpected = entries.filter((entry) => !allowedFile.test(entry));
	if (unexpected.length > 0) {
		throw new Error(
			`${pkg.name} tarball contains files that should not be published:\n  ${unexpected.join('\n  ')}`,
		);
	}
	const required = pkg.requiredFiles ?? defaultRequiredFiles;
	const missing = required.filter((file) => !entries.includes(`package/${file}`));
	if (missing.length > 0) {
		throw new Error(`${pkg.name} tarball is missing files:\n  ${missing.join('\n  ')}`);
	}

	if (pkg.workspaceDependencies === undefined) {
		const installDir = `${workDir}/consumer/node_modules/${pkg.name}`;
		await mkdir(resolve(root, installDir), { recursive: true });
		run('tar', ['-xzf', tarball, '-C', installDir, '--strip-components=1']);
		await writeFile(
			resolve(root, workDir, 'consumer/package.json'),
			'{"type":"module","private":true}\n',
		);
	} else {
		await install(pkg, tarball, workDir);
	}
	const consumerSource =
		pkg.consumer ??
		`
import assert from 'node:assert/strict';
import * as pkg from '${pkg.name}';

assert.deepEqual(Object.keys(pkg).sort(), ${JSON.stringify(pkg.exports)});
${pkg.behavior}`;
	await writeFile(resolve(root, workDir, 'consumer/check.mjs'), consumerSource);
	execFileSync(process.execPath, ['check.mjs'], {
		cwd: join(root, workDir, 'consumer'),
		stdio: 'inherit',
	});

	console.log(
		`Pack smoke test passed for ${pkg.name} (${String(entries.length)} files in ${basename(tarball)}).`,
	);
}

async function main() {
	const requested = process.argv.slice(2);
	const unknown = requested.filter((name) => !packages.some((pkg) => pkg.directory === name));
	if (unknown.length > 0) {
		throw new Error(`Unknown package: ${unknown.join(', ')}`);
	}
	const selected =
		requested.length === 0 ? packages : packages.filter((pkg) => requested.includes(pkg.directory));
	for (const pkg of selected) {
		await check(pkg);
	}
}

try {
	await main();
} finally {
	await rm(resolve(root, cacheDir), { recursive: true, force: true });
}
