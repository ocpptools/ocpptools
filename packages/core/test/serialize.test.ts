// SPDX-License-Identifier: Apache-2.0
// SPDX-FileCopyrightText: 2026 Rodolfo Carrillo

import { describe, expect, expectTypeOf, it } from 'vitest';
import {
	parseFrame,
	serializeFrame,
	type OcppFrame,
	type Result,
	type SerializeFrameError,
	type SerializeFrameErrorKind,
} from '../src/index.js';

function expectText(frame: OcppFrame): string {
	const result = serializeFrame(frame);
	if (!result.ok) {
		throw new Error(`expected text, got ${result.error.kind}: ${result.error.message}`);
	}
	return result.value;
}

function expectError(frame: unknown): SerializeFrameError {
	const result = serializeFrame(frame as OcppFrame);
	if (result.ok) {
		throw new Error('expected an error, got text');
	}
	return result.error;
}

describe('serializeFrame: valid frames', () => {
	it('serializes a CALL to compact JSON', () => {
		expect(expectText([2, '1', 'BootNotification', { chargePointVendor: 'Acme' }])).toBe(
			'[2,"1","BootNotification",{"chargePointVendor":"Acme"}]',
		);
	});

	it('serializes a CALLRESULT', () => {
		expect(expectText([3, '1', { status: 'Accepted' }])).toBe('[3,"1",{"status":"Accepted"}]');
	});

	it('serializes a CALLERROR', () => {
		expect(expectText([4, '1', 'NotImplemented', 'Unknown action', {}])).toBe(
			'[4,"1","NotImplemented","Unknown action",{}]',
		);
	});

	it('keeps array order and object key order', () => {
		expect(expectText([2, '1', 'X', { b: 1, a: [3, 1, 2], c: { z: 1, y: 2 } }])).toBe(
			'[2,"1","X",{"b":1,"a":[3,1,2],"c":{"z":1,"y":2}}]',
		);
	});

	it('keeps null, booleans, and unicode', () => {
		expect(expectText([3, '1', { a: null, b: false, name: 'Cargador ⚡', quote: 'a"b' }])).toBe(
			'[3,"1",{"a":null,"b":false,"name":"Cargador ⚡","quote":"a\\"b"}]',
		);
	});

	it('produces text that parseFrame reads back unchanged', () => {
		const frames: OcppFrame[] = [
			[2, 'a', 'Heartbeat', {}],
			[
				3,
				'a',
				{ currentTime: '2026-01-01T00:00:00Z', interval: 300, nested: { list: [1, null, 'x'] } },
			],
			[4, 'a', 'VendorError', '', { reason: 'x' }],
		];
		for (const frame of frames) {
			const parsed = parseFrame(expectText(frame));
			expect(parsed).toEqual({ ok: true, value: frame });
		}
	});
});

describe('serializeFrame: values JSON cannot represent', () => {
	it.each([
		['undefined', undefined],
		['a function', () => 1],
		['a symbol', Symbol('x')],
		['a BigInt', 10n],
		['NaN', Number.NaN],
		['Infinity', Number.POSITIVE_INFINITY],
		['-Infinity', Number.NEGATIVE_INFINITY],
	])('rejects %s in an object', (_name, value) => {
		expect(expectError([2, '1', 'X', { value }])).toMatchObject({ kind: 'unserializable' });
	});

	it('rejects undefined inside an array instead of writing null', () => {
		expect(expectError([2, '1', 'X', { list: [1, undefined, 3] }]).kind).toBe('unserializable');
	});

	it('names the offending key', () => {
		expect(expectError([2, '1', 'X', { count: Number.NaN }]).message).toContain('"count"');
	});

	it('rejects a circular payload', () => {
		const payload: Record<string, unknown> = {};
		payload['self'] = payload;
		expect(expectError([2, '1', 'X', payload]).kind).toBe('unserializable');
	});

	it('reports an error thrown by toJSON', () => {
		const payload = {
			toJSON() {
				throw new Error('boom');
			},
		};
		expect(expectError([2, '1', 'X', payload])).toEqual({
			kind: 'unserializable',
			message: 'boom',
		});
	});

	it('reports a non-Error value thrown by toJSON', () => {
		const payload = {
			toJSON() {
				// eslint-disable-next-line @typescript-eslint/only-throw-error
				throw 'boom';
			},
		};
		expect(expectError([2, '1', 'X', payload]).kind).toBe('unserializable');
	});

	it('rejects a missing frame', () => {
		expect(expectError(undefined).kind).toBe('unserializable');
	});
});

describe('serializeFrame: invalid frames', () => {
	it.each([
		['an unknown message type', [9, '1', 'X', {}]],
		['a numeric message ID', [2, 1, 'X', {}]],
		['an empty message ID', [2, '', 'X', {}]],
		['an empty action', [2, '1', '', {}]],
		['a missing element', [2, '1', 'X']],
		['an extra element', [3, '1', {}, {}]],
		['a null payload', [3, '1', null]],
		['an array payload', [2, '1', 'X', []]],
		['a non-string error code', [4, '1', 5, 'x', {}]],
		['an object instead of an array', { a: 1 }],
		['null', null],
		['a number', 5],
	])('rejects %s', (_name, frame) => {
		expect(expectError(frame)).toMatchObject({ kind: 'invalid-frame' });
	});
});

describe('serializeFrame types', () => {
	it('returns a result of text or error', () => {
		expectTypeOf(serializeFrame).returns.toEqualTypeOf<Result<string, SerializeFrameError>>();
		expectTypeOf<SerializeFrameError['kind']>().toEqualTypeOf<SerializeFrameErrorKind>();
	});
});
