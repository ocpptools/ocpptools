// SPDX-License-Identifier: Apache-2.0
// SPDX-FileCopyrightText: 2026 Rodolfo Carrillo

// Pure rules for `check-no-oca-schemas.mjs`. They live apart from the command
// so tests can call them without running Git.

// The OCA schemas identify themselves with this prefix (`id` in 1.6J, `$id` in
// 2.0.1). It is built from two parts so this file does not match its own rule.
export const OCA_SCHEMA_ID_PREFIX = 'urn:' + 'OCPP:';

// The OCA names its schema files after the message: `BootNotificationRequest.json`.
const schemaFileName = /^[A-Za-z0-9]+(Request|Response)\.json$/;

/**
 * Paths that may hold what the rules look for. Empty on purpose: the OCA
 * schemas are not Apache-2.0. Add a path only together with the written license
 * decision that covers it.
 *
 * @type {ReadonlySet<string>}
 */
export const allowedPaths = new Set();

/**
 * Directories that may hold the OCA schemas. This is the only place: the files
 * are byte-for-byte copies of the originals, licensed CC BY-ND 4.0 (see
 * docs/ADR/0003-oca-json-schemas.md), and `check-verbatim-schemas.mjs` checks
 * them against a manifest.
 *
 * @type {readonly string[]}
 */
export const allowedPrefixes = ['packages/schemas/schemas/'];

/**
 * @typedef {{ path: string, content: string | null }} CandidateFile
 * @typedef {{ path: string, reason: string }} Offender
 */

/**
 * @param {readonly CandidateFile[]} files Repository-relative paths with `/`
 *   separators. `content` is `null` for files that are not text.
 * @param {ReadonlySet<string>} [allowed]
 * @param {readonly string[]} [prefixes]
 * @returns {Offender[]}
 */
export function findOffenders(files, allowed = allowedPaths, prefixes = allowedPrefixes) {
	/** @type {Offender[]} */
	const offenders = [];
	for (const { path, content } of files) {
		if (allowed.has(path) || prefixes.some((prefix) => path.startsWith(prefix))) {
			continue;
		}
		const name = path.slice(path.lastIndexOf('/') + 1);
		if (schemaFileName.test(name)) {
			offenders.push({ path, reason: 'the file name looks like an OCA schema' });
		}
		if (content?.includes(OCA_SCHEMA_ID_PREFIX)) {
			offenders.push({ path, reason: `it contains "${OCA_SCHEMA_ID_PREFIX}", the OCA schema id` });
		}
	}
	return offenders;
}
