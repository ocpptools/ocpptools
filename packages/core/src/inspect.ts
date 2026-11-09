// SPDX-License-Identifier: Apache-2.0
// SPDX-FileCopyrightText: 2026 Rodolfo Carrillo

import { isErrorCode } from './error-codes.js';
import { MESSAGE_TYPE, type MessageId, type MessageType } from './frame.js';
import { OCPP_VERSIONS, isOcppVersion, type OcppVersion } from './version.js';

/** The longest message ID OCPP-J allows. */
export const MAX_MESSAGE_ID_LENGTH = 36;

/**
 * What is wrong with a frame:
 *
 * - `not-array`: the frame is not a JSON array.
 * - `empty-frame`: the array has no elements.
 * - `unknown-message-type`: the first element is not 2, 3, or 4.
 * - `wrong-length`: the array has the wrong number of elements for its type.
 * - `invalid-message-id`: the message ID is not a non-empty string.
 * - `long-message-id`: the message ID is longer than 36 characters (a warning).
 * - `invalid-action`: the action of a CALL is not a non-empty string.
 * - `invalid-payload`: the payload of a CALL or CALLRESULT is not a JSON object.
 * - `invalid-error-code`: the error code of a CALLERROR is not a string.
 * - `unknown-error-code`: the error code is not defined for the version given.
 * - `invalid-error-description`: the error description is not a string.
 * - `invalid-error-details`: the error details are not a JSON object.
 * - `unsupported-version`: the `version` option is not one this package supports. It
 *   reports a caller error, not a defect of the frame.
 */
export type FrameIssueCode =
	| 'not-array'
	| 'empty-frame'
	| 'unknown-message-type'
	| 'wrong-length'
	| 'invalid-message-id'
	| 'long-message-id'
	| 'invalid-action'
	| 'invalid-payload'
	| 'invalid-error-code'
	| 'unknown-error-code'
	| 'invalid-error-description'
	| 'invalid-error-details'
	| 'unsupported-version';

/** An `error` makes the frame invalid or reports an invalid option; a `warning` does not. */
export type FrameIssueSeverity = 'error' | 'warning';

export interface FrameIssue {
	readonly code: FrameIssueCode;
	readonly severity: FrameIssueSeverity;
	/** The index of the element in the frame, or empty for the frame as a whole. */
	readonly path: readonly number[];
	readonly message: string;
	/** What the element should be, in words. */
	readonly expected: string;
	/** What the element is: its JSON value when it is short, or its type. */
	readonly received: string;
}

export interface InspectFrameOptions {
	/**
	 * The OCPP version to check a CALLERROR error code against. Without it, any
	 * string is accepted, as `parseFrame` does. An unsupported value is reported
	 * as an `unsupported-version` issue.
	 */
	readonly version?: OcppVersion;
}

export interface FrameInspection {
	/** The message type, when the first element is a valid one. */
	readonly messageType?: MessageType;
	/** The message ID, when it is a non-empty string. Use it to reply with a CALLERROR. */
	readonly messageId?: MessageId;
	/**
	 * Every problem found, in the order of the elements. It is empty when the
	 * frame is valid and the options are valid.
	 */
	readonly issues: readonly FrameIssue[];
}

const MAX_RECEIVED_LENGTH = 40;

const expectedLength: Record<MessageType, number> = {
	[MESSAGE_TYPE.CALL]: 4,
	[MESSAGE_TYPE.CALLRESULT]: 3,
	[MESSAGE_TYPE.CALLERROR]: 5,
};

const typeNames: Record<MessageType, string> = {
	[MESSAGE_TYPE.CALL]: 'CALL',
	[MESSAGE_TYPE.CALLRESULT]: 'CALLRESULT',
	[MESSAGE_TYPE.CALLERROR]: 'CALLERROR',
};

function isMessageType(value: unknown): value is MessageType {
	return (
		value === MESSAGE_TYPE.CALL ||
		value === MESSAGE_TYPE.CALLRESULT ||
		value === MESSAGE_TYPE.CALLERROR
	);
}

function isJsonObject(value: unknown): boolean {
	return typeof value === 'object' && value !== null && !Array.isArray(value);
}

/** The kind of a value, as JSON names it. */
function kindOf(items: readonly unknown[], index: number): string {
	if (index >= items.length) {
		return 'missing';
	}
	const value = items[index];
	if (value === null) {
		return 'null';
	}
	return Array.isArray(value) ? 'array' : typeof value;
}

/** A short text for a value: its JSON when it is a primitive, otherwise its kind. */
function describeValue(value: unknown): string {
	const kind = value === null ? 'null' : Array.isArray(value) ? 'array' : typeof value;
	if (kind === 'string' || kind === 'number' || kind === 'boolean' || kind === 'null') {
		const text = JSON.stringify(value);
		return text.length > MAX_RECEIVED_LENGTH ? `${text.slice(0, MAX_RECEIVED_LENGTH - 1)}…` : text;
	}
	return kind;
}

/** A short text for a value: its JSON when it is a primitive, otherwise its kind. */
function show(items: readonly unknown[], index: number): string {
	if (index >= items.length) {
		return 'missing';
	}
	return describeValue(items[index]);
}

/**
 * Inspects a frame that has already been parsed from JSON, and reports every
 * structural problem instead of stopping at the first one. It applies the same
 * rules as `parseFrame`: a frame with no `error` issue is one that `parseFrame`
 * accepts. It adds a warning for a message ID longer than 36 characters, and,
 * when `version` is given, checks the CALLERROR error code against that version.
 * It does not check payloads against a schema, and it never throws. An
 * unsupported `version` option is reported as an `unsupported-version` issue.
 */
export function inspectFrame(frame: unknown, options: InspectFrameOptions = {}): FrameInspection {
	const issues: FrameIssue[] = [];
	const add = (
		code: FrameIssueCode,
		path: readonly number[],
		message: string,
		expected: string,
		received: string,
		severity: FrameIssueSeverity = 'error',
	): void => {
		issues.push({ code, severity, path, message, expected, received });
	};
	const requestedVersion = options.version;
	const version = isOcppVersion(requestedVersion) ? requestedVersion : undefined;
	if (requestedVersion !== undefined && version === undefined) {
		add(
			'unsupported-version',
			[],
			'The version option is not a supported OCPP version',
			`one of ${OCPP_VERSIONS.join(', ')}`,
			describeValue(requestedVersion),
		);
	}

	if (!Array.isArray(frame)) {
		add(
			'not-array',
			[],
			'A frame must be a JSON array',
			'array',
			frame === null ? 'null' : typeof frame,
		);
		return { issues };
	}
	const items: readonly unknown[] = frame;
	if (items.length === 0) {
		add(
			'empty-frame',
			[],
			'A frame must not be an empty array',
			'at least 3 elements',
			'0 elements',
		);
		return { issues };
	}

	const [type, id] = items;
	const messageType = isMessageType(type) ? type : undefined;
	if (messageType === undefined) {
		add(
			'unknown-message-type',
			[0],
			'The message type must be 2 (CALL), 3 (CALLRESULT), or 4 (CALLERROR)',
			'2, 3, or 4',
			show(items, 0),
		);
	}

	const messageId = typeof id === 'string' && id !== '' ? id : undefined;
	if (messageId === undefined) {
		add(
			'invalid-message-id',
			[1],
			'The message ID must be a non-empty string',
			'non-empty string',
			show(items, 1),
		);
	} else if (messageId.length > MAX_MESSAGE_ID_LENGTH) {
		add(
			'long-message-id',
			[1],
			`The message ID is longer than ${String(MAX_MESSAGE_ID_LENGTH)} characters`,
			`at most ${String(MAX_MESSAGE_ID_LENGTH)} characters`,
			`${String(messageId.length)} characters`,
			'warning',
		);
	}

	const identity = {
		...(messageType === undefined ? {} : { messageType }),
		...(messageId === undefined ? {} : { messageId }),
	};
	if (messageType === undefined) {
		// Without a message type there is no layout to check the other elements against.
		return { ...identity, issues };
	}

	const name = typeNames[messageType];
	const length = expectedLength[messageType];
	if (items.length !== length) {
		add(
			'wrong-length',
			[],
			`A ${name} frame must have ${String(length)} elements`,
			`${String(length)} elements`,
			`${String(items.length)} elements`,
		);
	}

	if (messageType === MESSAGE_TYPE.CALL) {
		const action = items[2];
		if (typeof action !== 'string' || action === '') {
			add(
				'invalid-action',
				[2],
				'The action must be a non-empty string',
				'non-empty string',
				show(items, 2),
			);
		}
		if (!isJsonObject(items[3])) {
			add('invalid-payload', [3], 'The payload must be a JSON object', 'object', kindOf(items, 3));
		}
	} else if (messageType === MESSAGE_TYPE.CALLRESULT) {
		if (!isJsonObject(items[2])) {
			add('invalid-payload', [2], 'The payload must be a JSON object', 'object', kindOf(items, 2));
		}
	} else {
		const code = items[2];
		if (typeof code !== 'string') {
			add('invalid-error-code', [2], 'The error code must be a string', 'string', show(items, 2));
		} else if (version !== undefined && !isErrorCode(version, code)) {
			add(
				'unknown-error-code',
				[2],
				`The error code is not defined for OCPP ${version}`,
				`an OCPP ${version} error code`,
				show(items, 2),
			);
		}
		if (typeof items[3] !== 'string') {
			add(
				'invalid-error-description',
				[3],
				'The error description must be a string',
				'string',
				kindOf(items, 3),
			);
		}
		if (!isJsonObject(items[4])) {
			add(
				'invalid-error-details',
				[4],
				'The error details must be a JSON object',
				'object',
				kindOf(items, 4),
			);
		}
	}

	return { ...identity, issues };
}
