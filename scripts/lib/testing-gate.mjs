// SPDX-License-Identifier: Apache-2.0
// SPDX-FileCopyrightText: 2026 Rodolfo Carrillo

/**
 * Returns an error message when the testing package looks publishable without
 * an explicit release decision in ROADMAP.md. A private package always passes.
 *
 * @param {{ private?: boolean, version?: string }} manifest
 * @param {string} roadmap
 * @returns {string | undefined}
 */
export function testingGateIssue(manifest, roadmap) {
	if (manifest.private === true) return undefined;
	if (typeof manifest.version !== 'string' || !/^\d+\.\d+\.\d+/.test(manifest.version)) {
		return 'packages/testing has an invalid version';
	}
	if (manifest.version === '0.0.0') {
		return 'packages/testing is public at 0.0.0; set 0.1.0 or later';
	}
	if (!/^testing-release-decision:\s*(https?:\/\/\S+|owner-override)\s*$/m.test(roadmap)) {
		return 'ROADMAP.md needs testing-release-decision: <issue URL> or owner-override';
	}
	if (!/^testing-approved:\s*\d{4}-\d{2}-\d{2}\s+\S+/m.test(roadmap)) {
		return 'ROADMAP.md needs testing-approved: <YYYY-MM-DD> <approver>';
	}
	return undefined;
}
