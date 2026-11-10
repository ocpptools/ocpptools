// SPDX-License-Identifier: Apache-2.0
// SPDX-FileCopyrightText: 2026 Rodolfo Carrillo

import { describe, expect, it } from 'vitest';

import { parseFrame, serializeFrame } from '@ocpptools/core';

import { FrameFactoryError } from '../src/errors.js';
import { createFrameFactory } from '../src/frames/factory.js';

describe('frame factory', () => {
	it('builds deterministic CALL, CALLRESULT and CALLERROR frames', () => {
		const frames = createFrameFactory({ version: '2.0.1' });
		const call = frames.call('Example', { value: 'x' });
		expect(call).toEqual([2, 'msg-1', 'Example', { value: 'x' }]);
		const result = frames.callResult(call, { value: 'ok' });
		expect(result).toEqual([3, 'msg-1', { value: 'ok' }]);
		const error = frames.callError(call, 'InternalError', 'failed');
		expect(error).toEqual([4, 'msg-1', 'InternalError', 'failed', {}]);
		const serialized = serializeFrame(call);
		expect(serialized.ok).toBe(true);
		if (serialized.ok) expect(parseFrame(serialized.value).ok).toBe(true);
	});

	it('uses independent counters and accepts an injected generator', () => {
		const first = createFrameFactory();
		const second = createFrameFactory();
		expect(first.call('Example', {})[1]).toBe('msg-1');
		expect(first.call('Example', {})[1]).toBe('msg-2');
		expect(second.call('Example', {})[1]).toBe('msg-1');
		const injected = createFrameFactory({ messageIds: () => 'explicit' });
		expect(injected.call('Example', {})[1]).toBe('explicit');
		expect(injected.callResult('other', {})[1]).toBe('other');
	});

	it('does not consume the counter for explicit IDs', () => {
		const frames = createFrameFactory();
		expect(frames.callResult('explicit', {})[1]).toBe('explicit');
		expect(frames.call('Example', {})[1]).toBe('msg-1');
	});

	it('validates error codes by version', () => {
		const one = createFrameFactory({ version: '1.6' });
		expect(one.callError('id', 'FormationViolation', 'bad')[2]).toBe('FormationViolation');
		expect(() => one.callError('id', 'FormatViolation', 'bad')).toThrow(
			expect.objectContaining({ code: 'invalid-error-code' }),
		);

		const two = createFrameFactory({ version: '2.0.1' });
		expect(two.callError('id', 'FormatViolation', 'bad')[2]).toBe('FormatViolation');
		expect(two.callError('id', 'MessageTypeNotSupported', 'bad')[2]).toBe(
			'MessageTypeNotSupported',
		);
		expect(() => two.callError('id', 'FormationViolation', 'bad')).toThrow(
			expect.objectContaining({ code: 'invalid-error-code' }),
		);
	});

	it('accepts unknown non-empty codes without a version but rejects empty codes', () => {
		const frames = createFrameFactory();
		expect(frames.callError('id', 'Unknown', 'bad')[2]).toBe('Unknown');
		expect(() => frames.callError('id', '', 'bad')).toThrow(
			expect.objectContaining({ code: 'invalid-error-code' }),
		);
	});

	it('rejects invalid actions and message IDs', () => {
		const frames = createFrameFactory();
		expect(() => frames.call('', {})).toThrow(expect.objectContaining({ code: 'invalid-action' }));
		expect(() => frames.callResult('', {})).toThrow(
			expect.objectContaining({ code: 'invalid-message-id' }),
		);
		expect(() => frames.callError('', 'InternalError', 'bad')).toThrow(
			expect.objectContaining({ code: 'invalid-message-id' }),
		);
		expect(() => frames.callResult(null as never, {})).toThrow(
			expect.objectContaining({ code: 'invalid-message-id' }),
		);
		expect(() => frames.callError(null as never, 'InternalError', 'bad')).toThrow(
			expect.objectContaining({ code: 'invalid-message-id' }),
		);
	});

	it('reports a failing or empty message ID generator', () => {
		const throwing = createFrameFactory({
			messageIds: () => {
				throw new Error('generator failed');
			},
		});
		expect(() => throwing.call('Example', {})).toThrow(
			expect.objectContaining({ code: 'invalid-message-id' }),
		);
		const empty = createFrameFactory({ messageIds: () => '' });
		expect(() => empty.call('Example', {})).toThrow(
			expect.objectContaining({ code: 'invalid-message-id' }),
		);
	});

	it('rejects non-plain payloads and details', () => {
		const frames = createFrameFactory();
		expect(() => frames.call('Example', new Date() as never)).toThrow(
			expect.objectContaining({ code: 'not-json' }),
		);
		expect(() => frames.call('Example', new Map() as never)).toThrow(
			expect.objectContaining({ code: 'not-json' }),
		);
		expect(() => frames.call('Example', [] as never)).toThrow(
			expect.objectContaining({ code: 'invalid-frame' }),
		);
		expect(() => frames.callResult('id', null as never)).toThrow(
			expect.objectContaining({ code: 'invalid-frame' }),
		);
		expect(() => frames.callError('id', 'InternalError', 'bad', [] as never)).toThrow(
			expect.objectContaining({ code: 'invalid-frame' }),
		);
		const cyclic: Record<string, unknown> = {};
		cyclic['self'] = cyclic;
		expect(() => frames.call('Example', cyclic as never)).toThrow(
			expect.objectContaining({ code: 'not-json' }),
		);
	});

	it('returns a fresh frame on every call', () => {
		const frames = createFrameFactory();
		const first = frames.call('Example', { value: 'x' });
		(first[3] as Record<string, unknown>)['value'] = 'changed';
		expect(frames.call('Example', { value: 'x' })[3]).toEqual({ value: 'x' });
	});

	it('allows long message IDs and reports structural issues on invalid codes', () => {
		const longFrames = createFrameFactory({ messageIds: () => 'x'.repeat(40) });
		const long = longFrames.call('Example', {});
		expect(long[1]).toHaveLength(40);

		const frames = createFrameFactory({ version: '2.0.1' });
		try {
			frames.callError('id', 'NotARealCode', 'bad');
		} catch (error) {
			expect(error).toBeInstanceOf(FrameFactoryError);
			const issueCodes = (error as FrameFactoryError).issues?.map((issue) => issue.code);
			expect(issueCodes).toContain('unknown-error-code');
		}
	});
});
