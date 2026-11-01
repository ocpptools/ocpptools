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

const allowedFile = /^package\/(package\.json|README\.md|LICENSE|NOTICE|dist\/.+)$/;
const requiredFiles = [
	'package.json',
	'README.md',
	'LICENSE',
	'NOTICE',
	'dist/index.js',
	'dist/index.d.ts',
];

// `exports` is the whole runtime API, so adding or removing an export fails
// here until it is listed on purpose. `behavior` runs in the consumer project
// with the package imported as `pkg`.
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
		exports: ['detectDraft', 'normalizeSchema'],
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
	const unexpected = entries.filter((entry) => !allowedFile.test(entry));
	if (unexpected.length > 0) {
		throw new Error(
			`${pkg.name} tarball contains files that should not be published:\n  ${unexpected.join('\n  ')}`,
		);
	}
	const missing = requiredFiles.filter((file) => !entries.includes(`package/${file}`));
	if (missing.length > 0) {
		throw new Error(`${pkg.name} tarball is missing files:\n  ${missing.join('\n  ')}`);
	}

	run('tar', ['-xzf', tarball, '-C', installDir, '--strip-components=1']);
	await writeFile(
		resolve(root, workDir, 'consumer/package.json'),
		'{"type":"module","private":true}\n',
	);
	const consumerSource = `
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
