// SPDX-License-Identifier: Apache-2.0
// SPDX-FileCopyrightText: 2026 Rodolfo Carrillo

// Fails when a workflow uses a mutable action reference. Every `uses:` must be
// pinned to a full commit SHA (or be a local action), so a tag cannot move
// under the repository.

import { readFileSync, readdirSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const workflows = join(root, '.github', 'workflows');
const failures = [];

for (const file of readdirSync(workflows).filter((name) => /\.ya?ml$/.test(name))) {
	const text = readFileSync(join(workflows, file), 'utf8');
	const lines = text.split(/\r?\n/);
	for (const [index, line] of lines.entries()) {
		const match = /^\s*(?:-\s*)?uses:\s*(\S+)/.exec(line);
		if (match === null) continue;
		const reference = match[1];
		if (reference.startsWith('./')) continue;
		if (!/@[0-9a-f]{40}$/.test(reference)) {
			failures.push(`${file}:${String(index + 1)} uses ${reference}`);
		}
	}
}

if (failures.length > 0) {
	for (const failure of failures) console.error(`Workflow pin: ${failure}`);
	process.exit(1);
}

console.log('Workflow pins: every action uses a full commit SHA.');
