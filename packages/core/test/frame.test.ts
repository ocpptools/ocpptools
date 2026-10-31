// SPDX-License-Identifier: Apache-2.0
// SPDX-FileCopyrightText: 2026 Rodolfo Carrillo

import { describe, expect, expectTypeOf, it } from 'vitest';
import {
	MESSAGE_TYPE,
	OCPP_SUBPROTOCOLS,
	OCPP_VERSIONS,
	isCall,
	isCallError,
	isCallResult,
	type CallErrorFrame,
	type CallFrame,
	type CallResultFrame,
	type OcppFrame,
	type OcppSubprotocol,
	type OcppVersion,
} from '../src/index.js';

const call: OcppFrame = [2, 'id-1', 'Heartbeat', {}];
const callResult: OcppFrame = [3, 'id-1', { currentTime: '2026-01-01T00:00:00Z' }];
const callError: OcppFrame = [4, 'id-1', 'NotImplemented', 'Unknown action', {}];

describe('MESSAGE_TYPE', () => {
	it('uses the OCPP-J message type ids', () => {
		expect(MESSAGE_TYPE).toEqual({ CALL: 2, CALLRESULT: 3, CALLERROR: 4 });
	});
});

describe('frame guards', () => {
	it('isCall accepts only CALL frames', () => {
		expect([call, callResult, callError].map(isCall)).toEqual([true, false, false]);
	});

	it('isCallResult accepts only CALLRESULT frames', () => {
		expect([call, callResult, callError].map(isCallResult)).toEqual([false, true, false]);
	});

	it('isCallError accepts only CALLERROR frames', () => {
		expect([call, callResult, callError].map(isCallError)).toEqual([false, false, true]);
	});

	it('narrows the frame type', () => {
		// Pass through a function so TypeScript keeps the full `OcppFrame` union
		// instead of narrowing the constant to its initial value.
		const frame = ((value: OcppFrame): OcppFrame => value)(call);
		if (isCall(frame)) {
			expectTypeOf(frame).toEqualTypeOf<CallFrame>();
			expect(frame[2]).toBe('Heartbeat');
		}
		if (isCallResult(frame)) {
			expectTypeOf(frame).toEqualTypeOf<CallResultFrame>();
		}
		if (isCallError(frame)) {
			expectTypeOf(frame).toEqualTypeOf<CallErrorFrame>();
		}
	});

	it('lets a CALL carry a literal action type', () => {
		expectTypeOf<CallFrame<'BootNotification'>[2]>().toEqualTypeOf<'BootNotification'>();
	});
});

describe('version constants', () => {
	it('lists the supported versions', () => {
		expect(OCPP_VERSIONS).toEqual(['1.6', '2.0.1']);
		expectTypeOf<OcppVersion>().toEqualTypeOf<'1.6' | '2.0.1'>();
	});

	it('maps each version to its WebSocket subprotocol', () => {
		expect(OCPP_SUBPROTOCOLS).toEqual({ '1.6': 'ocpp1.6', '2.0.1': 'ocpp2.0.1' });
		expectTypeOf<OcppSubprotocol>().toEqualTypeOf<'ocpp1.6' | 'ocpp2.0.1'>();
	});
});
