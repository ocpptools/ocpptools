// SPDX-License-Identifier: Apache-2.0
// SPDX-FileCopyrightText: 2026 Rodolfo Carrillo

import {
	MESSAGE_TYPE,
	inspectFrame,
	parseFrame,
	serializeFrame,
	type FrameIssue,
	type MessageId,
	type MessageType,
	type OcppFrame,
} from '@ocpptools/core';

import { SimulatorError } from './errors.js';

export interface InboundFrameSuccess {
	readonly ok: true;
	readonly frame: OcppFrame;
	readonly text: string;
}

export interface InboundFrameFailure {
	readonly ok: false;
	readonly text: string;
	readonly error: SimulatorError;
	readonly messageType?: MessageType;
	readonly messageId?: MessageId;
	readonly issues: readonly FrameIssue[];
}

export type InboundFrame = InboundFrameSuccess | InboundFrameFailure;

/** Reads a text frame and keeps enough identity to answer a malformed CALL. */
export function readInboundFrame(text: string): InboundFrame {
	const parsed = parseFrame(text);
	if (parsed.ok) {
		return { ok: true, frame: parsed.value, text };
	}

	let value: unknown;
	try {
		value = JSON.parse(text) as unknown;
	} catch {
		return {
			ok: false,
			text,
			error: new SimulatorError('invalid-json', parsed.error.message),
			issues: [],
		};
	}

	try {
		const inspection = inspectFrame(value);
		const issues = inspection.issues;
		return {
			ok: false,
			text,
			error: new SimulatorError('invalid-frame', parsed.error.message),
			...(inspection.messageType === undefined ? {} : { messageType: inspection.messageType }),
			...(inspection.messageId === undefined ? {} : { messageId: inspection.messageId }),
			issues,
		};
	} catch {
		return {
			ok: false,
			text,
			error: new SimulatorError('invalid-frame', parsed.error.message),
			issues: [],
		};
	}
}

/** Serializes a strict OCPP frame and throws a structured error on failure. */
export function writeFrame(frame: OcppFrame): string {
	const serialized = serializeFrame(frame);
	if (!serialized.ok) {
		throw new SimulatorError(
			frame[0] === MESSAGE_TYPE.CALL ? 'invalid-frame' : 'invalid-response',
			serialized.error.message,
		);
	}
	return serialized.value;
}

export function messageTypeName(type: MessageType): 'CALL' | 'CALLRESULT' | 'CALLERROR' {
	if (type === MESSAGE_TYPE.CALL) return 'CALL';
	if (type === MESSAGE_TYPE.CALLRESULT) return 'CALLRESULT';
	return 'CALLERROR';
}

export function frameAction(frame: OcppFrame): string | undefined {
	return frame[0] === MESSAGE_TYPE.CALL ? frame[2] : undefined;
}

export function frameMessageId(frame: OcppFrame): MessageId {
	return frame[1];
}

export function isJsonObject(value: unknown): value is Record<string, unknown> {
	return typeof value === 'object' && value !== null && !Array.isArray(value);
}
