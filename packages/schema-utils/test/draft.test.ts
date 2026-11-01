// SPDX-License-Identifier: Apache-2.0
// SPDX-FileCopyrightText: 2026 Rodolfo Carrillo

import { describe, expect, it } from 'vitest';

import { detectDraft } from '../src/draft.js';

describe('detectDraft', () => {
	it('reads the three supported drafts', () => {
		expect(detectDraft({ $schema: 'http://json-schema.org/draft-04/schema#' })).toBe('draft-04');
		expect(detectDraft({ $schema: 'http://json-schema.org/draft-06/schema#' })).toBe('draft-06');
		expect(detectDraft({ $schema: 'http://json-schema.org/draft-07/schema#' })).toBe('draft-07');
	});

	it('ignores the scheme, a trailing #, and letter case', () => {
		const variants = [
			'http://json-schema.org/draft-04/schema',
			'https://json-schema.org/draft-04/schema#',
			'https://json-schema.org/draft-04/schema',
			'HTTP://JSON-SCHEMA.ORG/draft-04/schema#',
		];
		for (const $schema of variants) {
			expect(detectDraft({ $schema })).toBe('draft-04');
		}
	});

	it('uses the default draft when there is no $schema', () => {
		expect(detectDraft({ type: 'object' })).toBe('draft-07');
		expect(detectDraft({ type: 'object' }, 'draft-04')).toBe('draft-04');
		expect(detectDraft({}, 'draft-06')).toBe('draft-06');
	});

	it('uses the default draft for values that are not objects', () => {
		for (const value of [true, false, null, undefined, 'text', 4, [{ $schema: 'x' }]]) {
			expect(detectDraft(value)).toBe('draft-07');
			expect(detectDraft(value, 'draft-04')).toBe('draft-04');
		}
	});

	it('reports unknown for other or malformed $schema values', () => {
		const values: unknown[] = [
			'https://json-schema.org/draft/2019-09/schema',
			'https://json-schema.org/draft/2020-12/schema',
			'http://json-schema.org/draft-03/schema#',
			'http://example.com/draft-04/schema',
			'http://json-schema.org/draft-04/schema#extra',
			'',
			'__proto__',
			'constructor',
			7,
			null,
			{ draft: 4 },
		];
		for (const $schema of values) {
			expect(detectDraft({ $schema })).toBe('unknown');
			expect(detectDraft({ $schema }, 'draft-04')).toBe('unknown');
		}
	});

	it('does not read $schema from the prototype chain', () => {
		const schema = Object.create({ $schema: 'http://json-schema.org/draft-04/schema#' }) as object;
		expect(detectDraft(schema)).toBe('draft-07');
	});
});
