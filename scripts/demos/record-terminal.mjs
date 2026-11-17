// SPDX-License-Identifier: Apache-2.0
// SPDX-FileCopyrightText: 2026 Rodolfo Carrillo

// Records the terminal demos in docs/assets with VHS, one GIF and one MP4 per
// tape in scripts/demos/terminal/tapes:
//
// - cli-demo: `ocpptools validate` and `ocpptools simulate`.
// - cli-ci: response validation with `--action`, and `--json` output.
// - testing-vitest: the test-without-a-network guide samples run by Vitest.
// - simulator-code: a simulated station driven from code.
//
// The demos run the published packages from npm, not the workspace build, so
// they show what users install. A synthetic local CSMS answers the simulator.
// Everything runs in a temporary workspace; only the rendered files are copied
// into docs/assets.
//
// Usage: node scripts/demos/record-terminal.mjs [--only <name>]... [--font <name>]

import { spawn } from 'node:child_process';
import {
	chmodSync,
	copyFileSync,
	cpSync,
	mkdirSync,
	readFileSync,
	readdirSync,
	writeFileSync,
} from 'node:fs';
import { basename, join } from 'node:path';
import { parseArgs } from 'node:util';

import { createWorkspace, demosDir, isWindows, publishAsset, requireTool, run } from './lib.mjs';

const PACKAGES = [
	'ocpptools@0.1.1',
	'@ocpptools/simulator@0.4.1',
	'@ocpptools/core@0.3.1',
	'@ocpptools/testing@0.1.1',
	'vitest@4.1.12',
	'ws@8.18.3',
];

const { values } = parseArgs({
	options: {
		only: { type: 'string', multiple: true },
		font: { type: 'string', default: isWindows ? 'Cascadia Mono' : 'JetBrains Mono' },
	},
});

const tapesDir = join(demosDir, 'terminal', 'tapes');
const available = readdirSync(tapesDir)
	.filter((name) => name.endsWith('.tape'))
	.map((name) => basename(name, '.tape'));
const selected = values.only ?? available;
for (const name of selected) {
	if (!available.includes(name)) {
		throw new Error(`Unknown demo "${name}". Available: ${available.join(', ')}`);
	}
}

requireTool('vhs', ['--version']);
requireTool('ttyd', ['--version']);
requireTool('ffmpeg', ['-version']);

const workspace = createWorkspace('terminal-demo');
const demo = join(workspace, 'demo');
const bin = join(workspace, 'bin');
const home = join(workspace, 'home');
for (const dir of [demo, bin, home]) mkdirSync(dir, { recursive: true });

// Install the published packages into the workspace. The demo directory has no
// package.json, so Node, npx, and Vitest resolve them from the parent.
writeFileSync(join(workspace, 'package.json'), '{ "private": true }\n');
run('npm', ['install', ...PACKAGES, '--no-audit', '--no-fund'], { cwd: workspace });

cpSync(join(demosDir, 'terminal', 'fixtures'), demo, { recursive: true });
copyFileSync(join(demosDir, 'terminal', 'csms.mjs'), join(workspace, 'csms.mjs'));

// Map the command name `ocpptools` to the installed executable, ahead of PATH.
const cliEntry = join(workspace, 'node_modules', 'ocpptools', 'dist', 'bin.js');
if (isWindows) {
	writeFileSync(join(bin, 'ocpptools.cmd'), `@"${process.execPath}" "${cliEntry}" %*\r\n`);
} else {
	writeFileSync(
		join(bin, 'ocpptools'),
		`#!/bin/sh\nexec "${process.execPath}" "${cliEntry}" "$@"\n`,
	);
	chmodSync(join(bin, 'ocpptools'), 0o755);
}

const shell = isWindows ? 'powershell' : 'bash';
const quote = (path) => `'${path.replaceAll("'", "''")}'`;
const setup = isWindows
	? [
			`$env:USERPROFILE = ${quote(home)}`,
			'$env:HOME = $env:USERPROFILE',
			`$env:Path = ${quote(`${bin};`)} + $env:Path`,
			`Set-Location ${quote(demo)}`,
			"function prompt { '> ' }",
			'Clear-Host',
		].join('; ')
	: [
			`export HOME=${quote(home)}`,
			`export PATH=${quote(bin)}:"$PATH"`,
			`cd ${quote(demo)}`,
			"PS1='> '",
			'clear',
		].join('; ');

// Start the synthetic CSMS and wait until it listens.
const csms = spawn(process.execPath, [join(workspace, 'csms.mjs')], {
	cwd: workspace,
	stdio: ['ignore', 'pipe', 'inherit'],
});
await new Promise((resolve, reject) => {
	csms.once('error', reject);
	csms.once('exit', (code) => reject(new Error(`The CSMS exited with code ${String(code)}`)));
	csms.stdout.on('data', (chunk) => {
		if (String(chunk).includes('listening')) resolve(undefined);
	});
});

try {
	for (const name of selected) {
		const outputGif = join(workspace, `${name}.gif`);
		const outputMp4 = join(workspace, `${name}.mp4`);
		const tape = readFileSync(join(tapesDir, `${name}.tape`), 'utf8')
			.replace('{{OUTPUT_GIF}}', outputGif.replaceAll('\\', '/'))
			.replace('{{OUTPUT_MP4}}', outputMp4.replaceAll('\\', '/'))
			.replaceAll('{{SHELL}}', shell)
			.replace('{{FONT}}', values.font)
			.replace('{{SETUP}}', setup);
		const tapePath = join(workspace, `${name}.tape`);
		writeFileSync(tapePath, tape);

		console.log(`Recording ${name}`);
		run('vhs', [tapePath], { cwd: workspace, shell: false });
		publishAsset(outputGif, `${name}.gif`);
		publishAsset(outputMp4, `${name}.mp4`);
	}
} finally {
	csms.kill();
}

console.log(`Tapes and workspace kept for inspection: ${workspace}`);
