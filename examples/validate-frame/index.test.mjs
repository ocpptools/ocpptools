// SPDX-License-Identifier: Apache-2.0
// SPDX-FileCopyrightText: 2026 Rodolfo Carrillo

import assert from 'node:assert/strict';
import { test } from 'node:test';

import { run } from './index.mjs';

test('validates a BootNotification frame', async () => {
	const result = await run();
	assert.equal(result.valid.status, 'valid');
	assert.equal(result.invalid.status, 'invalid-payload');
	assert.ok(result.invalid.issues.length > 0);
});
