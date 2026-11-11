// SPDX-License-Identifier: Apache-2.0
// SPDX-FileCopyrightText: 2026 Rodolfo Carrillo

// Fails if @ocpptools/testing is public without an explicit release decision
// in ROADMAP.md. This protects the gate when `private` is removed by mistake.

import { readFileSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

import { testingGateIssue } from './lib/testing-gate.mjs';

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const manifest = JSON.parse(readFileSync(join(root, 'packages/testing/package.json'), 'utf8'));
const roadmap = readFileSync(join(root, 'ROADMAP.md'), 'utf8');
const issue = testingGateIssue(manifest, roadmap);

if (issue !== undefined) {
	console.error(`Testing release gate: ${issue}`);
	process.exit(1);
}

console.log(
	manifest.private === true
		? 'Testing release gate: package is private.'
		: `Testing release gate: public ${manifest.version} approved.`,
);
