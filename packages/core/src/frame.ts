// SPDX-License-Identifier: Apache-2.0
// SPDX-FileCopyrightText: 2026 Rodolfo Carrillo

import type { JsonObject } from './json.js';

/** The `MessageTypeId` values defined by the OCPP-J RPC framework. */
export const MESSAGE_TYPE = {
	CALL: 2,
	CALLRESULT: 3,
	CALLERROR: 4,
} as const;

export type MessageType = (typeof MESSAGE_TYPE)[keyof typeof MESSAGE_TYPE];

/** Correlates a CALL with its CALLRESULT or CALLERROR. */
export type MessageId = string;

/** `[2, messageId, action, payload]`: a request. */
export type CallFrame<
	Action extends string = string,
	Payload extends JsonObject = JsonObject,
> = readonly [
	messageType: typeof MESSAGE_TYPE.CALL,
	messageId: MessageId,
	action: Action,
	payload: Payload,
];

/** `[3, messageId, payload]`: the response to a CALL. */
export type CallResultFrame<Payload extends JsonObject = JsonObject> = readonly [
	messageType: typeof MESSAGE_TYPE.CALLRESULT,
	messageId: MessageId,
	payload: Payload,
];

/**
 * `[4, messageId, errorCode, errorDescription, errorDetails]`: the error
 * response to a CALL. `errorCode` is a plain string because a peer can send a
 * code outside the specified set; see the per-version error code sets.
 */
export type CallErrorFrame = readonly [
	messageType: typeof MESSAGE_TYPE.CALLERROR,
	messageId: MessageId,
	errorCode: string,
	errorDescription: string,
	errorDetails: JsonObject,
];

export type OcppFrame = CallFrame | CallResultFrame | CallErrorFrame;

export function isCall(frame: OcppFrame): frame is CallFrame {
	return frame[0] === MESSAGE_TYPE.CALL;
}

export function isCallResult(frame: OcppFrame): frame is CallResultFrame {
	return frame[0] === MESSAGE_TYPE.CALLRESULT;
}

export function isCallError(frame: OcppFrame): frame is CallErrorFrame {
	return frame[0] === MESSAGE_TYPE.CALLERROR;
}
