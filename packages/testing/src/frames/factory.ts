// SPDX-License-Identifier: Apache-2.0
// SPDX-FileCopyrightText: 2026 Rodolfo Carrillo

import {
	inspectFrame,
	isOcppVersion,
	parseFrame,
	serializeFrame,
	type CallErrorFrame,
	type CallFrame,
	type CallResultFrame,
	type FrameIssue,
	type JsonObject,
	type MessageId,
	type OcppFrame,
	type OcppVersion,
} from '@ocpptools/core';

import { FrameFactoryError } from '../errors.js';
import { assertPlainJson, isPlainJsonObject, PlainJsonError } from '../plain-json.js';

export interface FrameFactoryOptions {
	/** When set, `callError` validates the code against that version. */
	readonly version?: OcppVersion;
	/** Message ID generator. Defaults to a deterministic counter per factory. */
	readonly messageIds?: () => string;
}

export interface FrameFactory {
	call(action: string, payload: JsonObject): CallFrame;
	callResult(call: CallFrame | MessageId, payload: JsonObject): CallResultFrame;
	callError(
		call: CallFrame | MessageId,
		code: string,
		description: string,
		details?: JsonObject,
	): CallErrorFrame;
}

type FrameKind = 'call' | 'call-result' | 'call-error';

function jsonError(error: unknown): FrameFactoryError {
	if (error instanceof PlainJsonError) {
		return new FrameFactoryError('not-json', error.message, { cause: error });
	}
	return new FrameFactoryError('not-json', 'The value is not plain JSON', { cause: error });
}

function assertObject(value: unknown, label: string): asserts value is JsonObject {
	try {
		assertPlainJson(value);
	} catch (error) {
		throw jsonError(error);
	}
	if (!isPlainJsonObject(value)) {
		throw new FrameFactoryError('invalid-frame', `The ${label} must be a JSON object`);
	}
}

function assertMessageId(value: unknown): asserts value is MessageId {
	if (typeof value !== 'string' || value === '') {
		throw new FrameFactoryError('invalid-message-id', 'The message ID must be a non-empty string');
	}
}

class FrameFactoryImpl implements FrameFactory {
	private readonly version: OcppVersion | undefined;
	private readonly messageIds: () => string;
	private counter = 0;

	constructor(options: FrameFactoryOptions = {}) {
		if (options.version !== undefined && !isOcppVersion(options.version)) {
			throw new FrameFactoryError(
				'invalid-frame',
				`Unsupported OCPP version: ${String(options.version)}`,
			);
		}
		this.version = options.version;
		this.messageIds = options.messageIds ?? (() => `msg-${String((this.counter += 1))}`);
	}

	call(action: string, payload: JsonObject): CallFrame {
		if (typeof action !== 'string' || action === '') {
			throw new FrameFactoryError('invalid-action', 'The action must be a non-empty string');
		}
		assertObject(payload, 'payload');
		const messageId = this.nextMessageId();
		return this.build([2, messageId, action, payload], 'call') as CallFrame;
	}

	callResult(call: CallFrame | MessageId, payload: JsonObject): CallResultFrame {
		const messageId = this.messageIdOf(call);
		assertObject(payload, 'payload');
		return this.build([3, messageId, payload], 'call-result') as CallResultFrame;
	}

	callError(
		call: CallFrame | MessageId,
		code: string,
		description: string,
		details: JsonObject = {},
	): CallErrorFrame {
		const messageId = this.messageIdOf(call);
		if (typeof code !== 'string' || code === '') {
			throw new FrameFactoryError(
				'invalid-error-code',
				'The error code must be a non-empty string',
			);
		}
		if (typeof description !== 'string') {
			throw new FrameFactoryError('invalid-frame', 'The error description must be a string');
		}
		assertObject(details, 'details');
		return this.build([4, messageId, code, description, details], 'call-error') as CallErrorFrame;
	}

	private nextMessageId(): MessageId {
		let value: unknown;
		try {
			value = this.messageIds();
		} catch (cause) {
			throw new FrameFactoryError('invalid-message-id', 'The message ID generator failed', {
				cause,
			});
		}
		assertMessageId(value);
		return value;
	}

	private messageIdOf(call: CallFrame | MessageId): MessageId {
		if (typeof call === 'string') {
			assertMessageId(call);
			return call;
		}
		if (!Array.isArray(call) || typeof call[1] !== 'string') {
			throw new FrameFactoryError(
				'invalid-message-id',
				'The message ID must be a non-empty string',
			);
		}
		assertMessageId(call[1]);
		return call[1];
	}

	private build(candidate: OcppFrame, kind: FrameKind): OcppFrame {
		const serialized = serializeFrame(candidate);
		if (!serialized.ok) {
			throw new FrameFactoryError(
				serialized.error.kind === 'unserializable' ? 'not-json' : 'invalid-frame',
				serialized.error.message,
			);
		}
		const parsed = parseFrame(serialized.value);
		if (!parsed.ok) {
			throw new FrameFactoryError('invalid-frame', parsed.error.message);
		}
		if (this.version !== undefined) {
			const inspection = inspectFrame(parsed.value, { version: this.version });
			const issues = inspection.issues.filter((issue) => issue.severity === 'error');
			if (issues.length > 0) {
				throw new FrameFactoryError(
					this.codeForIssues(issues, kind),
					issues.map((issue) => issue.message).join('; '),
					{ issues },
				);
			}
		}
		return parsed.value;
	}

	private codeForIssues(
		issues: readonly FrameIssue[],
		kind: FrameKind,
	): 'invalid-error-code' | 'invalid-frame' {
		if (kind === 'call-error' && issues.some((issue) => issue.code === 'unknown-error-code')) {
			return 'invalid-error-code';
		}
		return 'invalid-frame';
	}
}

/** Creates a frame factory with deterministic message IDs by default. */
export function createFrameFactory(options: FrameFactoryOptions = {}): FrameFactory {
	return new FrameFactoryImpl(options);
}
