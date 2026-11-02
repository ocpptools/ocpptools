// SPDX-License-Identifier: Apache-2.0
// SPDX-FileCopyrightText: 2026 Rodolfo Carrillo

// Fails when an OCA JSON Schema in `packages/schemas/schemas` differs from the
// official copy recorded in `packages/schemas/manifest.json`, when a file is
// added or missing, or when the two copies of the CC BY-ND 4.0 license text
// differ. See docs/ADR/0003-oca-json-schemas.md.

import { createHash } from 'node:crypto';
import { readFileSync, readdirSync } from 'node:fs';
import { dirname, join, relative, resolve, sep } from 'node:path';
import { fileURLToPath } from 'node:url';

import { compareWithManifest, sameBytes } from './lib/verbatim-schemas.mjs';

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const packageDir = join(root, 'packages/schemas');
const schemasDir = join(packageDir, 'schemas');

/** @param {Uint8Array} bytes */
function sha256(bytes) {
	return createHash('sha256').update(bytes).digest('hex');
}

const manifest = /** @type {{ files: Record<string, string> }} */ (
	JSON.parse(readFileSync(join(packageDir, 'manifest.json'), 'utf8'))
);

const actual = new Map();
for (const entry of readdirSync(schemasDir, { recursive: true, withFileTypes: true })) {
	if (entry.isFile()) {
		const path = join(entry.parentPath, entry.name);
		actual.set(relative(schemasDir, path).split(sep).join('/'), sha256(readFileSync(path)));
	}
}

const problems = compareWithManifest(manifest.files, actual);
const licenseCopies = [
	join(packageDir, 'LICENSE-CC-BY-ND-4.0.txt'),
	join(root, 'LICENSES/CC-BY-ND-4.0.txt'),
];
const [packageLicense, repositoryLicense] = licenseCopies.map((path) => readFileSync(path));

if (problems.length > 0 || !sameBytes(packageLicense, repositoryLicense)) {
	console.error('The OCA JSON Schemas must stay byte-for-byte identical to the originals.');
	console.error('Do not format, edit, or re-encode them. Restore the original file instead.');
	for (const { path, problem } of problems) {
		console.error(`  ${problem}: packages/schemas/schemas/${path}`);
	}
	if (!sameBytes(packageLicense, repositoryLicense)) {
		console.error('  The two copies of the CC BY-ND 4.0 license text differ.');
	}
	process.exit(1);
}

console.log(`OCA JSON Schemas are unchanged (${actual.size} files checked).`);
