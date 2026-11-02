// SPDX-License-Identifier: Apache-2.0
// SPDX-FileCopyrightText: 2026 Rodolfo Carrillo

// Pure rules for `check-verbatim-schemas.mjs`. The OCA JSON Schemas in
// `packages/schemas/schemas` are licensed CC BY-ND 4.0, which does not let
// anyone share modified copies. This check compares every file with the
// SHA-256 recorded when it was copied from the official OCA package.

/**
 * @typedef {{ path: string, problem: 'modified' | 'missing' | 'unlisted', expected?: string, actual?: string }} Problem
 */

/**
 * @param {Readonly<Record<string, string>>} expected Relative path to SHA-256, from the manifest.
 * @param {ReadonlyMap<string, string>} actual Relative path to SHA-256, from the files on disk.
 * @returns {Problem[]}
 */
export function compareWithManifest(expected, actual) {
	/** @type {Problem[]} */
	const problems = [];
	for (const [path, hash] of Object.entries(expected)) {
		const found = actual.get(path);
		if (found === undefined) {
			problems.push({ path, problem: 'missing', expected: hash });
		} else if (found !== hash) {
			problems.push({ path, problem: 'modified', expected: hash, actual: found });
		}
	}
	for (const path of actual.keys()) {
		if (!Object.hasOwn(expected, path)) {
			problems.push({ path, problem: 'unlisted' });
		}
	}
	return problems;
}

/**
 * @param {Uint8Array} first
 * @param {Uint8Array} second
 */
export function sameBytes(first, second) {
	return first.length === second.length && first.every((byte, index) => byte === second[index]);
}
