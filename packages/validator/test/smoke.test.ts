// SPDX-License-Identifier: Apache-2.0
// SPDX-FileCopyrightText: 2026 Rodolfo Carrillo

import { inspectFrame } from '@ocpptools/core';
import { normalizeSchema } from '@ocpptools/schema-utils';
import { describe, expect, it } from 'vitest';

describe('@ocpptools/validator', () => {
	it('exports an entrypoint', async () => {
		const entrypoint = await import('../src/index.js');
		expect(entrypoint).toBeTypeOf('object');
	});

	it('uses the workspace packages from their source', () => {
		expect(inspectFrame([2, 'id', 'Heartbeat', {}]).issues).toEqual([]);
		expect(normalizeSchema({ type: 'object' }).ok).toBe(true);
	});
});
