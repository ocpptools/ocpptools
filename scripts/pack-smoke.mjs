// SPDX-License-Identifier: Apache-2.0
// SPDX-FileCopyrightText: 2026 Rodolfo Carrillo

// Packs each package listed below, unpacks the tarball into a throwaway
// consumer project, and checks what a real user would get: the allowed files
// only, the expected public exports, and a working round trip. Run `pnpm build`
// first, because the tarballs ship `dist/`. Pass package directory names to
// check only those, for example `node scripts/pack-smoke.mjs core`.

import { execFileSync } from 'node:child_process';
import { mkdir, readdir, rm, writeFile } from 'node:fs/promises';
import { dirname, join, resolve } from 'node:path';
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
// `allowedFile`, `requiredFiles`, and its own `consumer` source instead.
const packages = [
	{
		directory: 'core',
		name: '@ocpptools/core',
		exports: [
			'MESSAGE_TYPE',
			'OCPP_ERROR_CODES',
			'OCPP_SUBPROTOCOLS',
			'OCPP_VERSIONS',
			'createMessageIdGenerator',
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

/** @param {(typeof packages)[number]} pkg */
async function check(pkg) {
	const workDir = `${cacheDir}/${pkg.directory}`;
	const installDir = `${workDir}/consumer/node_modules/${pkg.name}`;

	await rm(resolve(root, workDir), { recursive: true, force: true });
	await mkdir(resolve(root, installDir), { recursive: true });

	run('pnpm', ['--filter', pkg.name, 'pack', '--pack-destination', workDir]);
	const tarballs = (await readdir(resolve(root, workDir))).filter((name) => name.endsWith('.tgz'));
	if (tarballs.length !== 1) {
		throw new Error(`Expected one tarball in ${workDir}, found ${String(tarballs.length)}`);
	}
	const tarball = `${workDir}/${tarballs[0]}`;

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

	run('tar', ['-xzf', tarball, '-C', installDir, '--strip-components=1']);
	await writeFile(
		resolve(root, workDir, 'consumer/package.json'),
		'{"type":"module","private":true}\n',
	);
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
		`Pack smoke test passed for ${pkg.name} (${String(entries.length)} files in ${tarballs[0]}).`,
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
