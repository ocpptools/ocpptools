// SPDX-License-Identifier: Apache-2.0
// SPDX-FileCopyrightText: 2026 Rodolfo Carrillo

import { readFileSync } from 'node:fs';

interface PackageManifest {
	readonly version?: unknown;
}

function readVersion(): string {
	const manifest = JSON.parse(
		readFileSync(new URL('../package.json', import.meta.url), 'utf8'),
	) as PackageManifest;
	return typeof manifest.version === 'string' && manifest.version !== ''
		? manifest.version
		: '0.0.0';
}

/** The version of the installed `ocpptools` package. */
export const CLI_VERSION = readVersion();
