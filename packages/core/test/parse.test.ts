// SPDX-License-Identifier: Apache-2.0
// SPDX-FileCopyrightText: 2026 Rodolfo Carrillo

import { describe, expect, expectTypeOf, it } from 'vitest';
import {
	parseFrame,
	type OcppFrame,
	type ParseFrameError,
	type ParseFrameErrorKind,
	type Result,
} from '../src/index.js';

function expectFrame(text: string): OcppFrame {
	const result = parseFrame(text);
	if (!result.ok) {
		throw new Error(`expected a frame, got ${result.error.kind}: ${result.error.message}`);
	}
	return result.value;
}

function expectError(text: string): ParseFrameError {
	const result = parseFrame(text);
	if (result.ok) {
		throw new Error('expected an error, got a frame');
	}
	return result.error;
}

describe('parseFrame: valid frames', () => {
	it('parses a CALL', () => {
		expect(expectFrame('[2,"19223201","BootNotification",{"chargePointVendor":"Acme"}]')).toEqual([
			2,
			'19223201',
			'BootNotification',
			{ chargePointVendor: 'Acme' },
		]);
	});

	it('parses a CALL with an empty payload', () => {
		expect(expectFrame('[2,"1","Heartbeat",{}]')).toEqual([2, '1', 'Heartbeat', {}]);
	});

	it('parses a CALLRESULT', () => {
		expect(expectFrame('[3,"19223201",{"status":"Accepted"}]')).toEqual([
			3,
			'19223201',
			{ status: 'Accepted' },
		]);
	});

	it('parses a CALLERROR', () => {
		expect(expectFrame('[4,"1","NotImplemented","Unknown action",{}]')).toEqual([
			4,
			'1',
			'NotImplemented',
			'Unknown action',
			{},
		]);
	});

	it('accepts an empty error description', () => {
		expect(expectFrame('[4,"1","GenericError","",{}]')).toEqual([4, '1', 'GenericError', '', {}]);
	});

	it('accepts an error code outside the specified set', () => {
		expect(expectFrame('[4,"1","VendorSpecificError","x",{}]')[2]).toBe('VendorSpecificError');
	});

	it('keeps nested payloads and unicode intact', () => {
		const frame = expectFrame('[3,"1",{"a":{"b":[1,2,{"c":null}]},"name":"Cargador ⚡"}]');
		expect(frame[2]).toEqual({ a: { b: [1, 2, { c: null }] }, name: 'Cargador ⚡' });
	});

	it('accepts whitespace around the JSON', () => {
		expect(expectFrame('  [3, "1", {} ]\n')).toEqual([3, '1', {}]);
	});

	it('does not pollute Object.prototype through a __proto__ key', () => {
		const frame = expectFrame('[3,"1",{"__proto__":{"polluted":true}}]');
		expect(({} as Record<string, unknown>)['polluted']).toBeUndefined();
		expect(Object.getPrototypeOf(frame[2])).toBe(Object.prototype);
	});
});

describe('parseFrame: malformed frames', () => {
	it.each([
		['empty text', ''],
		['invalid JSON', '[2,"1","Heartbeat",{}'],
		['plain text', 'hello'],
		['a leading byte order mark', '﻿[3,"1",{}]'],
	])('rejects %s', (_name, text) => {
		expect(expectError(text).kind).toBe('malformed');
	});

	it.each([
		['an object', '{"a":1}'],
		['a string', '"[3,\\"1\\",{}]"'],
		['a number', '2'],
		['null', 'null'],
		['an empty array', '[]'],
	])('rejects %s instead of an array', (_name, text) => {
		expect(expectError(text).kind).toBe('malformed');
	});

	it.each([
		['CALL with 3 elements', '[2,"1","Heartbeat"]'],
		['CALL with 5 elements', '[2,"1","Heartbeat",{},{}]'],
		['CALLRESULT with 2 elements', '[3,"1"]'],
		['CALLRESULT with 4 elements', '[3,"1",{},{}]'],
		['CALLERROR with 4 elements', '[4,"1","GenericError","x"]'],
		['CALLERROR with 6 elements', '[4,"1","GenericError","x",{},{}]'],
	])('rejects a %s', (_name, text) => {
		const error = expectError(text);
		expect(error.kind).toBe('malformed');
		expect(error.messageId).toBeUndefined();
	});

	it.each([
		['a numeric message ID', '[2,1,"Heartbeat",{}]'],
		['a null message ID', '[3,null,{}]'],
		['an empty message ID', '[2,"","Heartbeat",{}]'],
		['an array message ID', '[4,["1"],"GenericError","x",{}]'],
	])('rejects %s', (_name, text) => {
		const error = expectError(text);
		expect(error.kind).toBe('malformed');
		expect(error.messageId).toBeUndefined();
	});

	it.each([
		['a numeric action', '[2,"1",5,{}]'],
		['an empty action', '[2,"1","",{}]'],
		['a null action', '[2,"1",null,{}]'],
	])('rejects a CALL with %s and reports the message ID', (_name, text) => {
		expect(expectError(text)).toMatchObject({ kind: 'malformed', messageId: '1' });
	});

	it.each([
		['a numeric error code', '[4,"1",7,"x",{}]'],
		['a null error code', '[4,"1",null,"x",{}]'],
		['a numeric error description', '[4,"1","GenericError",5,{}]'],
		['a null error description', '[4,"1","GenericError",null,{}]'],
	])('rejects a CALLERROR with %s and reports the message ID', (_name, text) => {
		expect(expectError(text)).toMatchObject({ kind: 'malformed', messageId: '1' });
	});
});

describe('parseFrame: unknown message types', () => {
	it.each([
		['0', '[0,"1","X",{}]'],
		['1', '[1,"1","X",{}]'],
		['5', '[5,"1","X",{}]'],
		['a negative number', '[-1,"1","X",{}]'],
		['a fraction', '[2.5,"1","X",{}]'],
		['a string', '["2","1","Heartbeat",{}]'],
		['null', '[null,"1"]'],
		['a boolean', '[true,"1"]'],
		['an object', '[{},"1"]'],
	])('rejects message type %s', (_name, text) => {
		expect(expectError(text)).toMatchObject({ kind: 'unknown-message-type', messageId: '1' });
	});

	it('omits the message ID when it cannot be read', () => {
		const error = expectError('[9]');
		expect(error.kind).toBe('unknown-message-type');
		expect(error.messageId).toBeUndefined();
	});
});

describe('parseFrame: invalid payloads', () => {
	it.each([
		['null', 'null'],
		['an array', '[]'],
		['a string', '"x"'],
		['a number', '5'],
		['a boolean', 'false'],
	])('rejects %s as a CALL payload', (_name, json) => {
		expect(expectError(`[2,"7","Heartbeat",${json}]`)).toMatchObject({
			kind: 'invalid-payload',
			messageId: '7',
		});
	});

	it.each([
		['null', 'null'],
		['an array', '[1]'],
		['a string', '"ok"'],
	])('rejects %s as a CALLRESULT payload', (_name, json) => {
		expect(expectError(`[3,"7",${json}]`)).toMatchObject({
			kind: 'invalid-payload',
			messageId: '7',
		});
	});

	it.each([
		['null', 'null'],
		['an array', '[]'],
		['a number', '0'],
	])('rejects %s as CALLERROR details', (_name, json) => {
		expect(expectError(`[4,"7","GenericError","x",${json}]`)).toMatchObject({
			kind: 'invalid-payload',
			messageId: '7',
		});
	});
});

describe('parseFrame: robustness', () => {
	it('never throws, even for input that is not a string', () => {
		const inputs: unknown[] = [undefined, null, 5, {}, []];
		for (const input of inputs) {
			const result = parseFrame(input as string);
			expect(result.ok).toBe(false);
		}
	});
});

describe('parseFrame types', () => {
	it('returns a result of frame or error', () => {
		expectTypeOf(parseFrame).returns.toEqualTypeOf<Result<OcppFrame, ParseFrameError>>();
		expectTypeOf<ParseFrameError['kind']>().toEqualTypeOf<ParseFrameErrorKind>();
	});

	it('narrows on ok', () => {
		const result = parseFrame('[3,"1",{}]');
		if (result.ok) {
			expectTypeOf(result.value).toEqualTypeOf<OcppFrame>();
		} else {
			expectTypeOf(result.error).toEqualTypeOf<ParseFrameError>();
		}
		expect(result.ok).toBe(true);
	});
});
