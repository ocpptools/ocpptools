// SPDX-License-Identifier: Apache-2.0
// SPDX-FileCopyrightText: 2026 Rodolfo Carrillo

import assert from 'node:assert/strict';
import { test } from 'node:test';

import { run } from './index.mjs';

test('builds a BootNotification CALL frame', async () => {
	const { call } = await run();
	assert.equal(call.ok, true);
	if (!call.ok) return;
	assert.equal(call.value[0], 2);
	assert.equal(call.value[1], 'example-1');
	assert.equal(call.value[2], 'BootNotification');
});

test('rejects a BootNotification without the required vendor name', async () => {
	const { invalid } = await run();
	assert.equal(invalid.ok, false);
	if (invalid.ok) return;
	assert.equal(invalid.error.code, 'missing-required');
});
