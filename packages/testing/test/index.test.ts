// SPDX-License-Identifier: Apache-2.0
// SPDX-FileCopyrightText: 2026 Rodolfo Carrillo

import { describe, expect, it } from 'vitest';

import * as testing from '../src/index.js';

describe('@ocpptools/testing exports', () => {
	it('exposes the documented runtime surface', () => {
		expect(Object.keys(testing).sort()).toEqual([
			'FakeClockError',
			'FrameFactoryError',
			'InMemoryTransportError',
			'MockCsmsCallError',
			'MockCsmsError',
			'createFakeClock',
			'createFrameFactory',
			'createInMemoryTransportHub',
			'createInMemoryTransportPair',
			'createMockCsms',
			'createSyntheticFixtures',
			'flushMicrotasks',
		]);
	});
});
