// SPDX-License-Identifier: Apache-2.0
// SPDX-FileCopyrightText: 2026 Rodolfo Carrillo

// Helpers shared by the demo recording scripts.

import { spawn, spawnSync } from 'node:child_process';
import { copyFileSync, mkdirSync, mkdtempSync, statSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

export const isWindows = process.platform === 'win32';
export const demosDir = dirname(fileURLToPath(import.meta.url));
export const repoRoot = resolve(demosDir, '..', '..');
export const assetsDir = join(repoRoot, 'docs', 'assets');

/**
 * Runs a command and fails on a non-zero exit code. On Windows, `npm` and the
 * `node_modules/.bin` shims are `.cmd` files, which need a shell; pass
 * `shell: false` for real executables whose arguments are paths. Every
 * argument passed here is a constant or a path created by these scripts.
 *
 * @param {string} command
 * @param {string[]} args
 * @param {{ cwd?: string, allowFailure?: boolean, quiet?: boolean, shell?: boolean }} [options]
 */
export function run(command, args, options = {}) {
	const result = spawnSync(command, args, {
		cwd: options.cwd,
		stdio: options.quiet ? 'pipe' : 'inherit',
		shell: options.shell ?? isWindows,
		encoding: 'utf8',
	});
	if (result.error) throw result.error;
	if (result.status !== 0 && !options.allowFailure) {
		throw new Error(`${command} ${args.join(' ')} exited with code ${String(result.status)}`);
	}
	return result;
}

/**
 * Like `run`, but does not block the event loop, so an in-process server can
 * keep answering requests while the command runs. Resolves with the exit code.
 *
 * @param {string} command
 * @param {string[]} args
 * @param {{ cwd?: string, shell?: boolean }} [options]
 * @returns {Promise<number | null>}
 */
export function runAsync(command, args, options = {}) {
	return new Promise((resolve, reject) => {
		const child = spawn(command, args, {
			cwd: options.cwd,
			stdio: 'inherit',
			shell: options.shell ?? isWindows,
		});
		child.once('error', reject);
		child.once('exit', (code) => resolve(code));
	});
}

/**
 * Fails with a clear message when a required tool is missing from PATH.
 *
 * @param {string} name
 * @param {string[]} versionArgs
 */
export function requireTool(name, versionArgs) {
	const result = spawnSync(name, versionArgs, { encoding: 'utf8', shell: isWindows });
	if (result.error || result.status !== 0) {
		throw new Error(`${name} is required but could not run. See scripts/demos/README.md.`);
	}
	const firstLine = `${result.stdout}${result.stderr}`.trim().split(/\r?\n/)[0];
	console.log(`${name}: ${firstLine}`);
}

/**
 * Creates a fresh temporary workspace outside the repository.
 *
 * @param {string} prefix
 */
export function createWorkspace(prefix) {
	const workspace = mkdtempSync(join(tmpdir(), `ocpptools-${prefix}-`));
	console.log(`Workspace: ${workspace}`);
	return workspace;
}

/**
 * Copies a rendered file into docs/assets and prints its size.
 *
 * @param {string} source
 * @param {string} name
 */
export function publishAsset(source, name) {
	mkdirSync(assetsDir, { recursive: true });
	const target = join(assetsDir, name);
	copyFileSync(source, target);
	const kib = Math.round(statSync(target).size / 1024);
	console.log(`Wrote docs/assets/${name} (${String(kib)} KiB)`);
}
