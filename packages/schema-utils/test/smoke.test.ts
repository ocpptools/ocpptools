// SPDX-License-Identifier: Apache-2.0
// SPDX-FileCopyrightText: 2026 Rodolfo Carrillo

import { describe, expect, it } from 'vitest';

describe('@ocpptools/schema-utils', () => {
	it('exports an entrypoint', async () => {
		const entrypoint = await import('../src/index.js');
		expect(entrypoint).toBeTypeOf('object');
	});
});
