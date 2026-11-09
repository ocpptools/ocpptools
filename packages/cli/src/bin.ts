#!/usr/bin/env node
// SPDX-License-Identifier: Apache-2.0
// SPDX-FileCopyrightText: 2026 Rodolfo Carrillo

import { runCli } from './index.js';
import { terminalSafe } from './text.js';

try {
	process.exitCode = await runCli(process.argv.slice(2));
} catch (error) {
	const message = error instanceof Error && error.message !== '' ? error.message : String(error);
	process.stderr.write(`ocpptools: unexpected failure: ${terminalSafe(message)}\n`);
	process.exitCode = 3;
}
