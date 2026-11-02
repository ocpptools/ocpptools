// SPDX-License-Identifier: Apache-2.0
// SPDX-FileCopyrightText: 2026 Rodolfo Carrillo

import { describe, expect, it } from 'vitest';

import { MAX_MESSAGE_ID_LENGTH, inspectFrame, type FrameIssue } from '../src/inspect.js';
import { parseFrame } from '../src/parse.js';

const codes = (issues: readonly FrameIssue[]): string[] => issues.map((issue) => issue.code);
const errors = (frame: unknown): string[] =>
	codes(inspectFrame(frame).issues.filter((issue) => issue.severity === 'error'));

describe('inspectFrame with valid frames', () => {
	it('accepts a CALL', () => {
		expect(inspectFrame([2, 'id-1', 'Heartbeat', {}])).toEqual({
			messageType: 2,
			messageId: 'id-1',
			issues: [],
		});
	});

	it('accepts a CALLRESULT', () => {
		expect(inspectFrame([3, 'id-1', { currentTime: 'now' }])).toEqual({
			messageType: 3,
			messageId: 'id-1',
			issues: [],
		});
	});

	it('accepts a CALLERROR, with any error code when no version is given', () => {
		for (const code of ['GenericError', 'FooError', '']) {
			expect(inspectFrame([4, 'id-1', code, '', {}])).toEqual({
				messageType: 4,
				messageId: 'id-1',
				issues: [],
			});
		}
	});
});

describe('inspectFrame with frames that are not arrays', () => {
	it('reports the type it found', () => {
		const cases: [unknown, string][] = [
			[{}, 'object'],
			['[2]', 'string'],
			[5, 'number'],
			[true, 'boolean'],
			[null, 'null'],
			[undefined, 'undefined'],
		];
		for (const [frame, received] of cases) {
			expect(inspectFrame(frame)).toEqual({
				issues: [
					{
						code: 'not-array',
						severity: 'error',
						path: [],
						message: 'A frame must be a JSON array',
						expected: 'array',
						received,
					},
				],
			});
		}
	});

	it('reports an empty array', () => {
		expect(inspectFrame([])).toEqual({
			issues: [
				{
					code: 'empty-frame',
					severity: 'error',
					path: [],
					message: 'A frame must not be an empty array',
					expected: 'at least 3 elements',
					received: '0 elements',
				},
			],
		});
	});
});

describe('inspectFrame with an unknown message type', () => {
	it('reports the value and stops before the type-specific checks', () => {
		const result = inspectFrame([5, 'id-1', 'Heartbeat', {}, 'extra']);
		expect(result).toEqual({
			messageId: 'id-1',
			issues: [
				{
					code: 'unknown-message-type',
					severity: 'error',
					path: [0],
					message: 'The message type must be 2 (CALL), 3 (CALLRESULT), or 4 (CALLERROR)',
					expected: '2, 3, or 4',
					received: '5',
				},
			],
		});
	});

	it('shows text and null as JSON, and other values by type', () => {
		const received = (type: unknown) => inspectFrame([type, 'id']).issues[0]?.received;
		expect(received('2')).toBe('"2"');
		expect(received(null)).toBe('null');
		expect(received(false)).toBe('false');
		expect(received([2])).toBe('array');
		expect(received({})).toBe('object');
	});

	it('also reports a bad message ID', () => {
		expect(codes(inspectFrame([1, 7]).issues)).toEqual([
			'unknown-message-type',
			'invalid-message-id',
		]);
		expect(inspectFrame([1, 7]).messageId).toBeUndefined();
	});
});

describe('inspectFrame with message IDs', () => {
	it('rejects a message ID that is not a non-empty string', () => {
		const cases: [unknown[], string][] = [
			[[2, 7, 'Heartbeat', {}], '7'],
			[[2, '', 'Heartbeat', {}], '""'],
			[[2, null, 'Heartbeat', {}], 'null'],
			[[2], 'missing'],
		];
		for (const [frame, received] of cases) {
			const issue = inspectFrame(frame).issues.find((entry) => entry.code === 'invalid-message-id');
			expect(issue).toEqual({
				code: 'invalid-message-id',
				severity: 'error',
				path: [1],
				message: 'The message ID must be a non-empty string',
				expected: 'non-empty string',
				received,
			});
			expect(inspectFrame(frame).messageId).toBeUndefined();
		}
	});

	it('warns about a message ID longer than 36 characters, without making the frame invalid', () => {
		expect(MAX_MESSAGE_ID_LENGTH).toBe(36);
		expect(inspectFrame([2, 'x'.repeat(36), 'Heartbeat', {}]).issues).toEqual([]);
		const long = inspectFrame([2, 'x'.repeat(37), 'Heartbeat', {}]);
		expect(long.messageId).toBe('x'.repeat(37));
		expect(long.issues).toEqual([
			{
				code: 'long-message-id',
				severity: 'warning',
				path: [1],
				message: 'The message ID is longer than 36 characters',
				expected: 'at most 36 characters',
				received: '37 characters',
			},
		]);
	});
});

describe('inspectFrame with CALL frames', () => {
	it('reports the wrong number of elements', () => {
		expect(inspectFrame([2, 'id', 'Heartbeat', {}, {}]).issues).toEqual([
			{
				code: 'wrong-length',
				severity: 'error',
				path: [],
				message: 'A CALL frame must have 4 elements',
				expected: '4 elements',
				received: '5 elements',
			},
		]);
	});

	it('reports a missing payload along with the length', () => {
		expect(codes(inspectFrame([2, 'id', 'Heartbeat']).issues)).toEqual([
			'wrong-length',
			'invalid-payload',
		]);
		expect(inspectFrame([2, 'id', 'Heartbeat']).issues[1]?.received).toBe('missing');
	});

	it('rejects an action that is not a non-empty string', () => {
		for (const action of [7, '', null]) {
			const issue = inspectFrame([2, 'id', action, {}]).issues[0];
			expect(issue).toMatchObject({
				code: 'invalid-action',
				severity: 'error',
				path: [2],
				expected: 'non-empty string',
			});
		}
	});

	it('rejects a payload that is not a JSON object', () => {
		const cases: [unknown, string][] = [
			[[], 'array'],
			[null, 'null'],
			['x', 'string'],
			[1, 'number'],
		];
		for (const [payload, received] of cases) {
			expect(inspectFrame([2, 'id', 'Heartbeat', payload]).issues).toEqual([
				{
					code: 'invalid-payload',
					severity: 'error',
					path: [3],
					message: 'The payload must be a JSON object',
					expected: 'object',
					received,
				},
			]);
		}
	});

	it('reports every problem at once', () => {
		expect(codes(inspectFrame([2, '', '', [], 'extra']).issues)).toEqual([
			'invalid-message-id',
			'wrong-length',
			'invalid-action',
			'invalid-payload',
		]);
	});
});

describe('inspectFrame with CALLRESULT frames', () => {
	it('reports the wrong number of elements and a bad payload', () => {
		expect(inspectFrame([3, 'id', {}, {}]).issues).toEqual([
			{
				code: 'wrong-length',
				severity: 'error',
				path: [],
				message: 'A CALLRESULT frame must have 3 elements',
				expected: '3 elements',
				received: '4 elements',
			},
		]);
		expect(inspectFrame([3, 'id', 'ok']).issues).toEqual([
			{
				code: 'invalid-payload',
				severity: 'error',
				path: [2],
				message: 'The payload must be a JSON object',
				expected: 'object',
				received: 'string',
			},
		]);
		expect(codes(inspectFrame([3, 'id']).issues)).toEqual(['wrong-length', 'invalid-payload']);
	});
});

describe('inspectFrame with CALLERROR frames', () => {
	it('reports the wrong number of elements', () => {
		expect(codes(inspectFrame([4, 'id', 'GenericError', 'text']).issues)).toEqual([
			'wrong-length',
			'invalid-error-details',
		]);
	});

	it('rejects an error code that is not a string', () => {
		expect(inspectFrame([4, 'id', 5, 'text', {}]).issues).toEqual([
			{
				code: 'invalid-error-code',
				severity: 'error',
				path: [2],
				message: 'The error code must be a string',
				expected: 'string',
				received: '5',
			},
		]);
	});

	it('checks the error code against the version when one is given', () => {
		const frame = (code: string) => [4, 'id', code, 'text', {}];
		expect(inspectFrame(frame('FormationViolation'), { version: '1.6' }).issues).toEqual([]);
		expect(inspectFrame(frame('FormatViolation'), { version: '2.0.1' }).issues).toEqual([]);
		expect(inspectFrame(frame('FormatViolation'), { version: '1.6' }).issues).toEqual([
			{
				code: 'unknown-error-code',
				severity: 'error',
				path: [2],
				message: 'The error code is not defined for OCPP 1.6',
				expected: 'an OCPP 1.6 error code',
				received: '"FormatViolation"',
			},
		]);
		expect(codes(inspectFrame(frame('FormationViolation'), { version: '2.0.1' }).issues)).toEqual([
			'unknown-error-code',
		]);
		expect(codes(inspectFrame(frame(''), { version: '2.0.1' }).issues)).toEqual([
			'unknown-error-code',
		]);
	});

	it('does not check the code against a version when it is not a string', () => {
		expect(codes(inspectFrame([4, 'id', null, 'text', {}], { version: '1.6' }).issues)).toEqual([
			'invalid-error-code',
		]);
	});

	it('rejects a description that is not a string and details that are not an object', () => {
		expect(inspectFrame([4, 'id', 'GenericError', 5, []]).issues).toEqual([
			{
				code: 'invalid-error-description',
				severity: 'error',
				path: [3],
				message: 'The error description must be a string',
				expected: 'string',
				received: 'number',
			},
			{
				code: 'invalid-error-details',
				severity: 'error',
				path: [4],
				message: 'The error details must be a JSON object',
				expected: 'object',
				received: 'array',
			},
		]);
	});
});

describe('inspectFrame details', () => {
	it('shortens a long value', () => {
		const received = inspectFrame([4, 'id', 'x'.repeat(100), 'text', {}], { version: '1.6' })
			.issues[0]?.received;
		expect(received).toHaveLength(40);
		expect(received?.endsWith('…')).toBe(true);
	});

	it('treats a hole in an array as an undefined element', () => {
		// eslint-disable-next-line no-sparse-arrays
		const frame = [2, , 'Heartbeat', {}];
		expect(inspectFrame(frame).issues[0]).toMatchObject({
			code: 'invalid-message-id',
			received: 'undefined',
		});
	});

	it('does not change the frame', () => {
		const frame = Object.freeze([2, 'id', 'Heartbeat', Object.freeze({})]);
		expect(inspectFrame(frame).issues).toEqual([]);
	});
});

describe('inspectFrame agrees with parseFrame', () => {
	const frames: unknown[] = [
		[2, 'id', 'Heartbeat', {}],
		[3, 'id', {}],
		[4, 'id', 'GenericError', '', {}],
		[4, 'id', '', '', {}],
		[2, 'x'.repeat(50), 'Heartbeat', {}],
		{},
		'x',
		[],
		[1, 'id'],
		['2', 'id', 'Heartbeat', {}],
		[2, 'id', 'Heartbeat'],
		[2, 'id', 'Heartbeat', {}, {}],
		[2, '', 'Heartbeat', {}],
		[2, 7, 'Heartbeat', {}],
		[2, 'id', '', {}],
		[2, 'id', 7, {}],
		[2, 'id', 'Heartbeat', []],
		[2, 'id', 'Heartbeat', null],
		[3, 'id'],
		[3, '', {}],
		[3, 'id', []],
		[4, 'id', 'GenericError', 'text'],
		[4, 'id', 5, 'text', {}],
		[4, 'id', 'GenericError', 5, {}],
		[4, 'id', 'GenericError', 'text', null],
	];

	it.each(frames.map((frame) => [JSON.stringify(frame), frame]))(
		'gives the same verdict for %s',
		(text, frame) => {
			expect(errors(frame).length === 0).toBe(parseFrame(text).ok);
		},
	);
});
