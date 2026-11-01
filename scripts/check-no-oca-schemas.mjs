// SPDX-License-Identifier: Apache-2.0
// SPDX-FileCopyrightText: 2026 Rodolfo Carrillo

// Fails when a file that Git tracks, or would track, looks like an OCA JSON
// Schema. The schemas are not Apache-2.0 and no license decision covers them
// yet (see AGENTS.md). Test fixtures must be synthetic. Files ignored by Git
// are skipped, so a local copy under `personal/` does not trip the check.

import { execFileSync } from 'node:child_process';
import { readFileSync } from 'node:fs';

import { findOffenders } from './lib/oca-schema-rules.mjs';

/** @param {string} path */
function readText(path) {
	let buffer;
	try {
		buffer = readFileSync(path);
	} catch {
		// Listed by Git but deleted from the working tree.
		return null;
	}
	return buffer.includes(0) ? null : buffer.toString('utf8');
}

const listed = execFileSync(
	'git',
	['ls-files', '-z', '--cached', '--others', '--exclude-standard'],
	{
		encoding: 'utf8',
		maxBuffer: 64 * 1024 * 1024,
	},
)
	.split('\0')
	.filter(Boolean);
const paths = [...new Set(listed)];

const offenders = findOffenders(paths.map((path) => ({ path, content: readText(path) })));

if (offenders.length > 0) {
	console.error('OCA JSON Schemas must not be added to this repository:');
	for (const { path, reason } of offenders) {
		console.error(`  ${path}: ${reason}`);
	}
	console.error('Write synthetic fixtures instead, with ids such as "urn:example:...".');
	process.exit(1);
}

console.log(`No OCA schemas found (${paths.length} files checked).`);
