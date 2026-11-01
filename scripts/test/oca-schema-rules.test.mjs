// SPDX-License-Identifier: Apache-2.0
// SPDX-FileCopyrightText: 2026 Rodolfo Carrillo

import { describe, expect, it } from 'vitest';

import { OCA_SCHEMA_ID_PREFIX, allowedPaths, findOffenders } from '../lib/oca-schema-rules.mjs';

const ocaId = `{ "$id": "${OCA_SCHEMA_ID_PREFIX}2.0.1:BootNotificationRequest" }`;

describe('findOffenders', () => {
	it('accepts ordinary files', () => {
		const files = [
			{ path: 'package.json', content: '{ "name": "ocpptools" }' },
			{ path: 'packages/core/src/index.ts', content: 'export {};' },
			{ path: 'docs/logo.png', content: null },
		];
		expect(findOffenders(files)).toEqual([]);
	});

	it('accepts synthetic fixtures', () => {
		const fixture = { path: 'packages/x/test/a.ts', content: '{ "$id": "urn:example:x" }' };
		expect(findOffenders([fixture])).toEqual([]);
	});

	it('flags a file named like an OCA schema', () => {
		const files = [
			{ path: 'schemas/BootNotificationRequest.json', content: '{}' },
			{ path: 'a/b/HeartbeatResponse.json', content: null },
		];
		expect(findOffenders(files).map((offender) => offender.path)).toEqual([
			'schemas/BootNotificationRequest.json',
			'a/b/HeartbeatResponse.json',
		]);
	});

	it('does not flag names that only end in Request or Response', () => {
		const files = [
			{ path: 'request.json', content: '{}' },
			{ path: 'my-request.json', content: '{}' },
			{ path: 'FooRequest.ts', content: '' },
		];
		expect(findOffenders(files)).toEqual([]);
	});

	it('flags the OCA schema id inside any text file', () => {
		const offenders = findOffenders([{ path: 'notes/copy.txt', content: ocaId }]);
		expect(offenders).toHaveLength(1);
		expect(offenders[0]?.path).toBe('notes/copy.txt');
		expect(offenders[0]?.reason).toContain(OCA_SCHEMA_ID_PREFIX);
	});

	it('reports both reasons when a file matches both rules', () => {
		const offenders = findOffenders([{ path: 'x/ResetRequest.json', content: ocaId }]);
		expect(offenders).toHaveLength(2);
	});

	it('skips files that are not text for the content rule', () => {
		expect(findOffenders([{ path: 'a.bin', content: null }])).toEqual([]);
	});

	it('honors an explicit allow list', () => {
		const files = [{ path: 'vendor/ResetRequest.json', content: ocaId }];
		expect(findOffenders(files, new Set(['vendor/ResetRequest.json']))).toEqual([]);
	});

	it('allows nothing by default', () => {
		expect(allowedPaths.size).toBe(0);
	});
});
