// SPDX-License-Identifier: Apache-2.0
// SPDX-FileCopyrightText: 2026 Rodolfo Carrillo

import type { FrameIssue, JsonObject } from '@ocpptools/core';

export type FrameFactoryErrorCode =
	'invalid-frame' | 'invalid-message-id' | 'invalid-action' | 'invalid-error-code' | 'not-json';

export interface FrameFactoryErrorOptions {
	readonly cause?: unknown;
	readonly issues?: readonly FrameIssue[];
}

export class FrameFactoryError extends Error {
	readonly code: FrameFactoryErrorCode;
	readonly issues?: readonly FrameIssue[];

	constructor(
		code: FrameFactoryErrorCode,
		message: string,
		options: FrameFactoryErrorOptions = {},
	) {
		super(message, options.cause === undefined ? undefined : { cause: options.cause });
		this.name = 'FrameFactoryError';
		this.code = code;
		if (options.issues !== undefined) this.issues = options.issues;
	}
}

export type InMemoryTransportErrorCode =
	'closed' | 'invalid-option' | 'not-making-progress' | 'not-open' | 'queue-overflow';

export interface TestingErrorOptions {
	readonly cause?: unknown;
}

export class InMemoryTransportError extends Error {
	readonly code: InMemoryTransportErrorCode;

	constructor(
		code: InMemoryTransportErrorCode,
		message: string,
		options: TestingErrorOptions = {},
	) {
		super(message, options.cause === undefined ? undefined : { cause: options.cause });
		this.name = 'InMemoryTransportError';
		this.code = code;
	}
}

export type MockCsmsErrorCode =
	| 'closed'
	| 'duplicate-message-id'
	| 'not-open'
	| 'protocol'
	| 'send-failed'
	| 'serialization-failed';

export class MockCsmsError extends Error {
	readonly code: MockCsmsErrorCode;

	constructor(code: MockCsmsErrorCode, message: string, options: TestingErrorOptions = {}) {
		super(message, options.cause === undefined ? undefined : { cause: options.cause });
		this.name = 'MockCsmsError';
		this.code = code;
	}
}

export interface MockCsmsCallErrorOptions {
	readonly cause?: unknown;
	readonly origin?: 'local' | 'peer';
}

export class MockCsmsCallError extends Error {
	readonly code: string;
	readonly description: string;
	readonly details: JsonObject;
	readonly origin: 'local' | 'peer';

	constructor(
		code: string,
		description: string,
		details: JsonObject = {},
		options: MockCsmsCallErrorOptions = {},
	) {
		super(description, options.cause === undefined ? undefined : { cause: options.cause });
		this.name = 'MockCsmsCallError';
		this.code = code;
		this.description = description;
		this.details = details;
		this.origin = options.origin ?? 'local';
	}
}

export type FakeClockErrorCode = 'invalid-rounds' | 'invalid-time' | 'not-making-progress';

export class FakeClockError extends Error {
	readonly code: FakeClockErrorCode;

	constructor(code: FakeClockErrorCode, message: string, options: TestingErrorOptions = {}) {
		super(message, options.cause === undefined ? undefined : { cause: options.cause });
		this.name = 'FakeClockError';
		this.code = code;
	}
}
