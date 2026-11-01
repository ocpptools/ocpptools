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
 * schemas are not Apache-2.0, and no decision allows them here yet. Add a path
 * only together with the written license decision that covers it.
 *
 * @type {ReadonlySet<string>}
 */
export const allowedPaths = new Set();

/**
 * @typedef {{ path: string, content: string | null }} CandidateFile
 * @typedef {{ path: string, reason: string }} Offender
 */

/**
 * @param {readonly CandidateFile[]} files Repository-relative paths with `/`
 *   separators. `content` is `null` for files that are not text.
 * @param {ReadonlySet<string>} [allowed]
 * @returns {Offender[]}
 */
export function findOffenders(files, allowed = allowedPaths) {
	/** @type {Offender[]} */
	const offenders = [];
	for (const { path, content } of files) {
		if (allowed.has(path)) {
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
