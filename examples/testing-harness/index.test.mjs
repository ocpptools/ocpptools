// SPDX-License-Identifier: Apache-2.0
// SPDX-FileCopyrightText: 2026 Rodolfo Carrillo

import assert from 'node:assert/strict';
import { test } from 'node:test';

import { run } from './index.mjs';

test('answers a Heartbeat through the in-memory transport', async () => {
	const result = await run();
	assert.deepEqual(result.calls, ['Heartbeat']);
	assert.deepEqual(result.results, [3]);
	assert.equal(result.errors, 0);
});
