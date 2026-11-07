// SPDX-License-Identifier: Apache-2.0
// SPDX-FileCopyrightText: 2026 Rodolfo Carrillo

import { describe, expect, it } from 'vitest';

import { SIMULATOR_NAME } from '@ocpptools/simulator';
import { SIMULATOR_PROTOCOL_VERSION as VERSION_16 } from '@ocpptools/simulator/1.6';
import { SIMULATOR_PROTOCOL_VERSION as VERSION_201 } from '@ocpptools/simulator/2.0.1';
import { SIMULATOR_BROWSER_ENTRY } from '@ocpptools/simulator/browser';

describe('@ocpptools/simulator', () => {
	it('exposes its entrypoints', () => {
		expect(SIMULATOR_NAME).toBe('@ocpptools/simulator');
		expect(VERSION_16).toBe('1.6');
		expect(VERSION_201).toBe('2.0.1');
		expect(SIMULATOR_BROWSER_ENTRY).toBe(true);
	});
});
