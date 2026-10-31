// SPDX-License-Identifier: Apache-2.0
// SPDX-FileCopyrightText: 2026 Rodolfo Carrillo

import { afterEach, describe, expect, expectTypeOf, it, vi } from 'vitest';
import {
	createMessageIdGenerator,
	type MessageId,
	type MessageIdGenerator,
	type RandomUuidSource,
} from '../src/index.js';

const uuidPattern = /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/;

afterEach(() => {
	vi.unstubAllGlobals();
});

describe('createMessageIdGenerator', () => {
	it('generates UUIDs of 36 characters by default', () => {
		const next = createMessageIdGenerator();
		const id = next();
		expect(id).toHaveLength(36);
		expect(id).toMatch(uuidPattern);
	});

	it('generates a different ID on every call', () => {
		const next = createMessageIdGenerator();
		const ids = new Set(Array.from({ length: 1000 }, () => next()));
		expect(ids.size).toBe(1000);
	});

	it('uses the source it is given', () => {
		let count = 0;
		const source: RandomUuidSource = { randomUUID: () => `id-${String(++count)}` };
		const next = createMessageIdGenerator(source);
		expect([next(), next(), next()]).toEqual(['id-1', 'id-2', 'id-3']);
	});

	it('uses globalThis.crypto when no source is given', () => {
		vi.stubGlobal('crypto', { randomUUID: () => 'from-global' });
		expect(createMessageIdGenerator()()).toBe('from-global');
	});

	it('throws when there is no crypto.randomUUID', () => {
		vi.stubGlobal('crypto', undefined);
		expect(() => createMessageIdGenerator()).toThrow('crypto.randomUUID is not available');
	});

	it('throws when the source has no randomUUID', () => {
		expect(() => createMessageIdGenerator({} as RandomUuidSource)).toThrow(
			'crypto.randomUUID is not available',
		);
	});

	it('has the generator and source types', () => {
		expectTypeOf(createMessageIdGenerator).returns.toEqualTypeOf<MessageIdGenerator>();
		expectTypeOf<MessageIdGenerator>().toEqualTypeOf<() => MessageId>();
	});
});
