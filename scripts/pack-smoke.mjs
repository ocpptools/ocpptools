// SPDX-License-Identifier: Apache-2.0
// SPDX-FileCopyrightText: 2026 Rodolfo Carrillo

// Packs @ocpptools/core, unpacks the tarball into a throwaway consumer project,
// and checks what a real user would get: the allowed files only, the expected
// public exports, and a working parse and serialize round trip. Run `pnpm build`
// first, because the tarball ships `dist/`.

import { execFileSync } from 'node:child_process';
import { mkdir, readdir, rm, writeFile } from 'node:fs/promises';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..');
// Inside the repository (`.cache/` is gitignored) so every path stays relative
// and free of spaces, which tar and the Windows shell both need.
const workDir = '.cache/pack-smoke';
const installDir = `${workDir}/consumer/node_modules/@ocpptools/core`;

const allowedFile = /^package\/(package\.json|README\.md|LICENSE|NOTICE|dist\/.+)$/;
const requiredFiles = [
	'package.json',
	'README.md',
	'LICENSE',
	'NOTICE',
	'dist/index.js',
	'dist/index.d.ts',
];
const expectedExports = [
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
];

const consumerSource = `
import assert from 'node:assert/strict';
import * as core from '@ocpptools/core';

assert.deepEqual(Object.keys(core).sort(), ${JSON.stringify(expectedExports)});

const text = '[2,"19223201","BootNotification",{"chargePointVendor":"Acme"}]';
const parsed = core.parseFrame(text);
assert.ok(parsed.ok);
assert.ok(core.isCall(parsed.value));
const serialized = core.serializeFrame(parsed.value);
assert.deepEqual(serialized, { ok: true, value: text });

assert.equal(core.parseFrame('[9]').error.kind, 'unknown-message-type');
assert.ok(core.isErrorCode('1.6', 'FormationViolation'));
assert.ok(!core.isErrorCode('2.0.1', 'FormationViolation'));
assert.equal(core.createMessageIdGenerator()().length, 36);
`;

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

async function main() {
	await rm(resolve(root, workDir), { recursive: true, force: true });
	await mkdir(resolve(root, installDir), { recursive: true });

	run('pnpm', ['--filter', '@ocpptools/core', 'pack', '--pack-destination', workDir]);
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
			`Tarball contains files that should not be published:\n  ${unexpected.join('\n  ')}`,
		);
	}
	const missing = requiredFiles.filter((file) => !entries.includes(`package/${file}`));
	if (missing.length > 0) {
		throw new Error(`Tarball is missing files:\n  ${missing.join('\n  ')}`);
	}

	run('tar', ['-xzf', tarball, '-C', installDir, '--strip-components=1']);
	await writeFile(
		resolve(root, workDir, 'consumer/package.json'),
		'{"type":"module","private":true}\n',
	);
	await writeFile(resolve(root, workDir, 'consumer/check.mjs'), consumerSource);
	execFileSync(process.execPath, ['check.mjs'], {
		cwd: join(root, workDir, 'consumer'),
		stdio: 'inherit',
	});

	console.log(`Pack smoke test passed (${String(entries.length)} files in ${tarballs[0]}).`);
}

try {
	await main();
} finally {
	await rm(resolve(root, workDir), { recursive: true, force: true });
}
