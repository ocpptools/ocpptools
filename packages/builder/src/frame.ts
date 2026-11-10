// SPDX-License-Identifier: Apache-2.0
// SPDX-FileCopyrightText: 2026 Rodolfo Carrillo

import {
	MAX_MESSAGE_ID_LENGTH,
	MESSAGE_TYPE,
	isErrorCode,
	serializeFrame,
	type CallErrorFrame,
	type CallFrame,
	type CallResultFrame,
	type JsonObject,
	type OcppFrame,
	type OcppVersion,
} from '@ocpptools/core';

import { invalidAction, invalidMessageId, issue, messageOf, serializeFailed } from './errors.js';
import { cloneJson, type JsonLimits } from './json.js';
import { buildPayloadFor } from './payload.js';
import type { Path } from '@ocpptools/schema-utils';

import type { SchemaLoader } from './schema.js';
import type {
	BuilderIssue,
	BuilderResult,
	BuilderWarning,
	CallOptions,
	PayloadKind,
} from './types.js';

const ACTION = /^[A-Za-z0-9]+$/;

export function validAction(action: unknown): action is string {
	return typeof action === 'string' && ACTION.test(action);
}

export function validKind(kind: unknown): kind is PayloadKind {
	return kind === 'request' || kind === 'response';
}

function validMessageId(messageId: unknown): messageId is string {
	return (
		typeof messageId === 'string' && messageId !== '' && messageId.length <= MAX_MESSAGE_ID_LENGTH
	);
}

function frameIssue(
	code: BuilderIssue['code'],
	path: Path,
	message: string,
	expected?: string,
	received?: unknown,
): BuilderIssue {
	return issue('frame', code, path, message, expected, received);
}

function failure<T>(
	error: BuilderIssue,
	warnings: readonly BuilderWarning[] = [],
): BuilderResult<T> {
	return { ok: false, error, warnings };
}

export async function buildCallFor(
	loader: SchemaLoader,
	version: OcppVersion,
	action: string,
	input: unknown,
	options: CallOptions,
	messageIds: () => string,
	limits: JsonLimits,
): Promise<BuilderResult<CallFrame>> {
	if (!validAction(action)) return failure(invalidAction(action));
	let provided: unknown;
	try {
		provided = options.messageId;
	} catch (error) {
		return failure(
			frameIssue(
				'invalid-message-id',
				[1],
				`The messageId option could not be read: ${messageOf(error)}`,
			),
		);
	}
	if (provided !== undefined && typeof provided !== 'string') {
		return failure(invalidMessageId(provided));
	}
	let messageId: string;
	try {
		messageId = provided ?? messageIds();
	} catch (error) {
		return failure(
			frameIssue('invalid-message-id', [1], `The message ID generator failed: ${messageOf(error)}`),
		);
	}
	if (!validMessageId(messageId)) return failure(invalidMessageId(messageId));
	const payload = await buildPayloadFor(loader, action, input, { kind: 'request' }, limits);
	if (!payload.ok) return payload;
	return {
		ok: true,
		value: [MESSAGE_TYPE.CALL, messageId, action, payload.value],
		warnings: payload.warnings,
	};
}

export async function buildResultFor(
	loader: SchemaLoader,
	action: string,
	input: unknown,
	messageId: string,
	limits: JsonLimits,
): Promise<BuilderResult<CallResultFrame>> {
	if (!validAction(action)) return failure(invalidAction(action));
	if (!validMessageId(messageId)) return failure(invalidMessageId(messageId));
	const payload = await buildPayloadFor(loader, action, input, { kind: 'response' }, limits);
	if (!payload.ok) return payload;
	return {
		ok: true,
		value: [MESSAGE_TYPE.CALLRESULT, messageId, payload.value],
		warnings: payload.warnings,
	};
}

export function buildErrorFor(
	version: OcppVersion,
	messageId: string,
	code: string,
	description: string,
	details: JsonObject | undefined,
	limits: JsonLimits,
): BuilderResult<CallErrorFrame> {
	if (!validMessageId(messageId)) return failure(invalidMessageId(messageId));
	if (!isErrorCode(version, code)) {
		return failure(
			frameIssue(
				'invalid-error-code',
				[2],
				`The error code is not defined for OCPP ${version}`,
				`an OCPP ${version} error code`,
				code,
			),
		);
	}
	if (typeof description !== 'string') {
		return failure(frameIssue('invalid-payload', [3], 'The error description must be a string'));
	}
	const cloned = cloneJson(details ?? {}, limits);
	if (!cloned.ok) {
		return failure(
			frameIssue(
				cloned.error.code === 'limit-exceeded' ? 'limit-exceeded' : 'not-json',
				[4, ...cloned.error.path],
				cloned.error.message,
				'error details as a JSON object',
				cloned.error.received,
			),
		);
	}
	if (typeof cloned.value !== 'object' || cloned.value === null || Array.isArray(cloned.value)) {
		return failure(
			frameIssue(
				'invalid-payload',
				[4],
				'The error details must be a JSON object',
				'object',
				cloned.value,
			),
		);
	}
	return {
		ok: true,
		value: [MESSAGE_TYPE.CALLERROR, messageId, code, description, cloned.value],
		warnings: [],
	};
}

export function serializeFor(frame: OcppFrame, limits: JsonLimits): BuilderResult<string> {
	const cloned = cloneJson(frame, limits);
	if (!cloned.ok) {
		return failure(
			frameIssue(
				cloned.error.code === 'limit-exceeded' ? 'limit-exceeded' : 'not-json',
				cloned.error.path,
				cloned.error.message,
				'a JSON OCPP-J frame',
				cloned.error.received,
			),
		);
	}
	const serialized = serializeFrame(cloned.value as unknown as OcppFrame);
	if (!serialized.ok) return failure(serializeFailed(serialized.error.message));
	return { ok: true, value: serialized.value, warnings: [] };
}
