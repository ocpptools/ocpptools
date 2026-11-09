// SPDX-License-Identifier: Apache-2.0
// SPDX-FileCopyrightText: 2026 Rodolfo Carrillo

import { describe, expect, it } from 'vitest';

import { OCPP_VERSIONS, isOcppVersion } from '../src/index.js';

describe('isOcppVersion', () => {
	it('accepts the supported versions', () => {
		for (const version of OCPP_VERSIONS) {
			expect(isOcppVersion(version)).toBe(true);
		}
	});

	it('rejects anything else, including OCPP 2.1.0', () => {
		for (const value of ['2.1.0', '2.1', '1.5', '', '1.6J', 16, null, undefined, {}, []]) {
			expect(isOcppVersion(value)).toBe(false);
		}
	});
});
