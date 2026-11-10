// SPDX-License-Identifier: Apache-2.0
// SPDX-FileCopyrightText: 2026 Rodolfo Carrillo

import { OCPP_VERSIONS, isOcppVersion, type OcppVersion } from '@ocpptools/core';

export const DEFAULT_SCHEMA_MAX_DEPTH = 128;
export const DEFAULT_SCHEMA_MAX_NODES = 100_000;
export const DEFAULT_PAYLOAD_MAX_DEPTH = 64;
export const DEFAULT_PAYLOAD_MAX_NODES = 10_000;

export interface VersionDefaults {
	readonly defaultDraft: 'draft-04' | 'draft-06';
}

export function versionDefaults(version: OcppVersion): VersionDefaults {
	return {
		defaultDraft: version === '1.6' ? 'draft-04' : 'draft-06',
	};
}

export function assertVersion(version: unknown): asserts version is OcppVersion {
	if (!isOcppVersion(version)) {
		throw new Error(
			`Unsupported OCPP version: ${String(version)}. Supported versions: ${OCPP_VERSIONS.join(' and ')}`,
		);
	}
}

export function positiveLimit(value: unknown, fallback: number, name: string): number {
	if (value === undefined) return fallback;
	if (typeof value !== 'number' || !Number.isSafeInteger(value) || value <= 0) {
		throw new Error(`${name} must be a positive safe integer`);
	}
	return value;
}
