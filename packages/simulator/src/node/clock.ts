// SPDX-License-Identifier: Apache-2.0
// SPDX-FileCopyrightText: 2026 Rodolfo Carrillo

import { clearTimeout, setTimeout } from 'node:timers';

import type { Clock } from '@ocpptools/core';

/** A `Clock` backed by Node's `Date` and timers. */
export const nodeClock: Clock = {
	now: () => Date.now(),
	setTimeout: (callback, delayMs) => setTimeout(callback, delayMs),
	clearTimeout: (handle) => {
		clearTimeout(handle as NodeJS.Timeout);
	},
};
