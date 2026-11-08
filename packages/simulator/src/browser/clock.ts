// SPDX-License-Identifier: Apache-2.0
// SPDX-FileCopyrightText: 2026 Rodolfo Carrillo

import type { Clock } from '@ocpptools/core';

/** A `Clock` backed by the browser's `Date` and timers. */
export const browserClock: Clock = {
	now: () => Date.now(),
	setTimeout: (callback, delayMs) => globalThis.setTimeout(callback, delayMs),
	clearTimeout: (handle) => {
		globalThis.clearTimeout(handle as number);
	},
};
