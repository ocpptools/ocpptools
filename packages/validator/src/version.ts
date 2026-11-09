// SPDX-License-Identifier: Apache-2.0
// SPDX-FileCopyrightText: 2026 Rodolfo Carrillo

import { OCPP_VERSIONS, isOcppVersion, type OcppVersion } from '@ocpptools/core';

/**
 * Rejects an OCPP version this package does not support. TypeScript already
 * limits the public options, but JavaScript callers and data from the outside
 * need a clear runtime error instead of a later, confusing failure.
 */
export function assertOcppVersion(version: unknown): asserts version is OcppVersion {
	if (!isOcppVersion(version)) {
		throw new Error(
			`Unsupported OCPP version: ${String(version)}. Supported versions: ${OCPP_VERSIONS.join(' and ')}`,
		);
	}
}
