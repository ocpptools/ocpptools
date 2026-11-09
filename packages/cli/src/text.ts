// SPDX-License-Identifier: Apache-2.0
// SPDX-FileCopyrightText: 2026 Rodolfo Carrillo

// eslint-disable-next-line no-control-regex -- stripping terminal controls is the point
const CONTROL = new RegExp('[\\u0000-\\u0008\\u000B\\u000C\\u000E-\\u001F\\u007F-\\u009F]', 'g');

/** Removes terminal control characters from human-readable output. */
export function terminalSafe(value: string): string {
	return value.replace(CONTROL, '?');
}
