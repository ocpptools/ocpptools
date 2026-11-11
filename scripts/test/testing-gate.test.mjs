// SPDX-License-Identifier: Apache-2.0
// SPDX-FileCopyrightText: 2026 Rodolfo Carrillo

import { describe, expect, it } from 'vitest';

import { testingGateIssue } from '../lib/testing-gate.mjs';

const approved = [
	'testing-release-decision: https://github.com/ocpptools/ocpptools/issues/1',
	'testing-approved: 2026-11-11 owner',
].join('\n');

describe('testing release gate', () => {
	it('allows a private package without a decision', () => {
		expect(testingGateIssue({ private: true, version: '0.0.0' }, '')).toBeUndefined();
	});

	it('rejects a public 0.0.0 package', () => {
		expect(testingGateIssue({ version: '0.0.0' }, approved)).toContain('0.0.0');
	});

	it('rejects a public package without a decision', () => {
		expect(testingGateIssue({ version: '0.1.0' }, '')).toContain('testing-release-decision');
	});

	it('rejects a decision without approval', () => {
		expect(
			testingGateIssue(
				{ version: '0.1.0' },
				'testing-release-decision: https://github.com/ocpptools/ocpptools/issues/1',
			),
		).toContain('testing-approved');
	});

	it('accepts an issue decision with approval', () => {
		expect(testingGateIssue({ version: '0.1.0' }, approved)).toBeUndefined();
	});

	it('accepts the explicit owner override', () => {
		const roadmap = [
			'testing-release-decision: owner-override',
			'testing-approved: 2026-11-11 owner',
		].join('\n');
		expect(testingGateIssue({ version: '0.1.0' }, roadmap)).toBeUndefined();
	});
});
