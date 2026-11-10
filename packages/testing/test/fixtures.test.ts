// SPDX-License-Identifier: Apache-2.0
// SPDX-FileCopyrightText: 2026 Rodolfo Carrillo

import { describe, expect, it } from 'vitest';

import { parseFrame } from '@ocpptools/core';

import { createSyntheticFixtures } from '../src/frames/fixtures.js';

describe('synthetic fixtures', () => {
	it('returns fresh synthetic frames and payloads', () => {
		const fixtures = createSyntheticFixtures();
		const first = fixtures.call();
		const second = fixtures.call();
		expect(first).not.toBe(second);
		expect(first[2]).toBe('Example');
		expect(first[3]).toEqual({ value: 'example' });

		const payload = fixtures.payload();
		payload['value'] = 'changed';
		expect(fixtures.payload()['value']).toBe('example');
	});

	it('uses the call ID for result and error fixtures', () => {
		const fixtures = createSyntheticFixtures({ version: '2.0.1' });
		const call = fixtures.call();
		expect(fixtures.callResult(call)[1]).toBe(call[1]);
		expect(fixtures.callError(call)[1]).toBe(call[1]);
		expect(fixtures.callResult()[1]).toBe('msg-2');
		expect(fixtures.callError()[1]).toBe('msg-3');
	});

	it('provides invalid frames that the parser rejects', () => {
		const fixtures = createSyntheticFixtures();
		for (const frame of fixtures.invalidFrames()) {
			const text = typeof frame === 'string' ? frame : JSON.stringify(frame);
			expect(parseFrame(text).ok).toBe(false);
		}
		expect(fixtures.invalidFrames()).not.toBe(fixtures.invalidFrames());
	});

	it('honors the version option for error codes', () => {
		const fixtures = createSyntheticFixtures({ version: '1.6' });
		expect(fixtures.callError()[2]).toBe('InternalError');
	});
});
