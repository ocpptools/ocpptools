// SPDX-License-Identifier: Apache-2.0
// SPDX-FileCopyrightText: 2026 Rodolfo Carrillo

import assert from 'node:assert/strict';
import { test } from 'node:test';

import { run } from './index.mjs';

test('runs a complete 1.6J transaction', async () => {
	const result = await run();
	assert.equal(result.ready, true);
	assert.equal(result.completedTransactions, 1);
	for (const action of [
		'BootNotification',
		'Authorize',
		'StartTransaction',
		'MeterValues',
		'StopTransaction',
	]) {
		assert.ok(result.calls.includes(action), `missing ${action}`);
	}
});
