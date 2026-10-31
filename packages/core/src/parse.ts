// SPDX-License-Identifier: Apache-2.0
// SPDX-FileCopyrightText: 2026 Rodolfo Carrillo

import {
	MESSAGE_TYPE,
	type CallErrorFrame,
	type CallFrame,
	type CallResultFrame,
	type MessageId,
	type OcppFrame,
} from './frame.js';
import type { JsonObject } from './json.js';
import type { Result } from './result.js';

/**
 * Why a frame was rejected:
 *
 * - `malformed`: not JSON, not an array, or the wrong shape for its message type.
 * - `unknown-message-type`: the first element is not 2, 3, or 4.
 * - `invalid-payload`: the payload or error details is not a JSON object.
 */
export type ParseFrameErrorKind = 'malformed' | 'unknown-message-type' | 'invalid-payload';

export interface ParseFrameError {
	readonly kind: ParseFrameErrorKind;
	readonly message: string;
	/** The frame's message ID, when it could be read. Use it to reply with a CALLERROR. */
	readonly messageId?: MessageId;
}

function fail(
	kind: ParseFrameErrorKind,
	message: string,
	messageId?: MessageId,
): Result<never, ParseFrameError> {
	const error: ParseFrameError =
		messageId === undefined ? { kind, message } : { kind, message, messageId };
	return { ok: false, error };
}

function isJsonObject(value: unknown): value is JsonObject {
	return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function isNonEmptyString(value: unknown): value is string {
	return typeof value === 'string' && value !== '';
}

function parseCall(items: readonly unknown[]): Result<CallFrame, ParseFrameError> {
	if (items.length !== 4) {
		return fail('malformed', `CALL must have 4 elements, got ${String(items.length)}`);
	}
	const [, messageId, action, payload] = items;
	if (!isNonEmptyString(messageId)) {
		return fail('malformed', 'CALL message ID must be a non-empty string');
	}
	if (!isNonEmptyString(action)) {
		return fail('malformed', 'CALL action must be a non-empty string', messageId);
	}
	if (!isJsonObject(payload)) {
		return fail('invalid-payload', 'CALL payload must be a JSON object', messageId);
	}
	return { ok: true, value: [MESSAGE_TYPE.CALL, messageId, action, payload] };
}

function parseCallResult(items: readonly unknown[]): Result<CallResultFrame, ParseFrameError> {
	if (items.length !== 3) {
		return fail('malformed', `CALLRESULT must have 3 elements, got ${String(items.length)}`);
	}
	const [, messageId, payload] = items;
	if (!isNonEmptyString(messageId)) {
		return fail('malformed', 'CALLRESULT message ID must be a non-empty string');
	}
	if (!isJsonObject(payload)) {
		return fail('invalid-payload', 'CALLRESULT payload must be a JSON object', messageId);
	}
	return { ok: true, value: [MESSAGE_TYPE.CALLRESULT, messageId, payload] };
}

function parseCallError(items: readonly unknown[]): Result<CallErrorFrame, ParseFrameError> {
	if (items.length !== 5) {
		return fail('malformed', `CALLERROR must have 5 elements, got ${String(items.length)}`);
	}
	const [, messageId, errorCode, errorDescription, errorDetails] = items;
	if (!isNonEmptyString(messageId)) {
		return fail('malformed', 'CALLERROR message ID must be a non-empty string');
	}
	if (typeof errorCode !== 'string') {
		return fail('malformed', 'CALLERROR error code must be a string', messageId);
	}
	if (typeof errorDescription !== 'string') {
		return fail('malformed', 'CALLERROR error description must be a string', messageId);
	}
	if (!isJsonObject(errorDetails)) {
		return fail('invalid-payload', 'CALLERROR error details must be a JSON object', messageId);
	}
	return {
		ok: true,
		value: [MESSAGE_TYPE.CALLERROR, messageId, errorCode, errorDescription, errorDetails],
	};
}

/**
 * Parses one OCPP-J text frame. Parsing is strict and structural: it checks the
 * frame shape and that payloads are JSON objects, but it does not validate a
 * payload against an action's schema and it accepts any CALLERROR error code
 * (see `isErrorCode`). It never throws.
 */
export function parseFrame(text: string): Result<OcppFrame, ParseFrameError> {
	let value: unknown;
	try {
		value = JSON.parse(text);
	} catch {
		return fail('malformed', 'Frame is not valid JSON');
	}
	if (!Array.isArray(value)) {
		return fail('malformed', 'Frame must be a JSON array');
	}
	const items: readonly unknown[] = value;
	if (items.length === 0) {
		return fail('malformed', 'Frame must not be an empty array');
	}
	switch (items[0]) {
		case MESSAGE_TYPE.CALL:
			return parseCall(items);
		case MESSAGE_TYPE.CALLRESULT:
			return parseCallResult(items);
		case MESSAGE_TYPE.CALLERROR:
			return parseCallError(items);
		default:
			return fail(
				'unknown-message-type',
				'Message type must be 2 (CALL), 3 (CALLRESULT), or 4 (CALLERROR)',
				isNonEmptyString(items[1]) ? items[1] : undefined,
			);
	}
}
