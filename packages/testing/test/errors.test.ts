// SPDX-License-Identifier: Apache-2.0
// SPDX-FileCopyrightText: 2026 Rodolfo Carrillo

import { describe, expect, it } from 'vitest';

import {
	FakeClockError,
	FrameFactoryError,
	InMemoryTransportError,
	MockCsmsCallError,
	MockCsmsError,
} from '../src/errors.js';

describe('testing errors', () => {
	it('preserves names, codes, causes and instanceof', () => {
		const cause = new Error('root cause');
		const frame = new FrameFactoryError('not-json', 'bad payload', {
			cause,
			issues: [],
		});
		expect(frame).toBeInstanceOf(Error);
		expect(frame).toBeInstanceOf(FrameFactoryError);
		expect(frame.name).toBe('FrameFactoryError');
		expect(frame.code).toBe('not-json');
		expect(frame.cause).toBe(cause);
		expect(frame.issues).toEqual([]);

		const transport = new InMemoryTransportError('queue-overflow', 'full', { cause });
		expect(transport.name).toBe('InMemoryTransportError');
		expect(transport.code).toBe('queue-overflow');
		expect(transport.cause).toBe(cause);

		const clock = new FakeClockError('invalid-time', 'bad time');
		expect(clock.name).toBe('FakeClockError');
		expect(clock.code).toBe('invalid-time');

		const csms = new MockCsmsError('protocol', 'bad frame', { cause });
		expect(csms.name).toBe('MockCsmsError');
		expect(csms.code).toBe('protocol');
		expect(csms.cause).toBe(cause);
	});

	it('creates MockCsmsCallError with local defaults and peer origin', () => {
		const local = new MockCsmsCallError('InternalError', 'failed');
		expect(local.name).toBe('MockCsmsCallError');
		expect(local.code).toBe('InternalError');
		expect(local.description).toBe('failed');
		expect(local.details).toEqual({});
		expect(local.origin).toBe('local');

		const peer = new MockCsmsCallError('NotSupported', 'no', { value: 1 }, { origin: 'peer' });
		expect(peer.origin).toBe('peer');
		expect(peer.details).toEqual({ value: 1 });
	});

	it('supports the no-cause and no-issues branches', () => {
		expect(new FrameFactoryError('invalid-frame', 'x').issues).toBeUndefined();
		expect(new InMemoryTransportError('not-open', 'x').cause).toBeUndefined();
		expect(new MockCsmsError('protocol', 'x').cause).toBeUndefined();
		const cause = new Error('cause');
		expect(new FakeClockError('invalid-time', 'x', { cause }).cause).toBe(cause);
	});
});
