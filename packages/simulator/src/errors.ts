// SPDX-License-Identifier: Apache-2.0
// SPDX-FileCopyrightText: 2026 Rodolfo Carrillo

import type { JsonObject } from '@ocpptools/core';

/** Local failures of the simulator, separate from OCPP CALLERROR codes. */
export type SimulatorErrorCode =
	| 'not-connected'
	| 'connection-failed'
	| 'not-ready'
	| 'timeout'
	| 'call-error'
	| 'disconnected'
	| 'send-failed'
	| 'cancelled'
	| 'duplicate-message-id'
	| 'invalid-frame'
	| 'invalid-json'
	| 'invalid-response'
	| 'protocol-error'
	| 'invalid-options'
	| 'invalid-error-code'
	| 'validation-blocked'
	| 'queue-full'
	| 'not-implemented'
	| 'unsupported-feature'
	| 'invalid-snapshot'
	| 'persistence-failed'
	| 'scenario-cancelled'
	| 'scenario-failed'
	| 'callback-error'
	| 'disposed'
	| 'internal-error';

/** A serializable description of an error. Events and history never carry Error instances. */
export interface SimulatorErrorSnapshot {
	readonly name: string;
	readonly code: SimulatorErrorCode;
	readonly message: string;
	readonly cause?: string;
	readonly details?: JsonObject;
}

/** A local simulator failure. */
export class SimulatorError extends Error {
	readonly code: SimulatorErrorCode;
	readonly details?: JsonObject;

	constructor(
		code: SimulatorErrorCode,
		message: string,
		options?: { cause?: unknown; details?: JsonObject },
	) {
		super(message, options?.cause === undefined ? undefined : { cause: options.cause });
		this.name = 'SimulatorError';
		this.code = code;
		this.details = options?.details;
	}
}

/** A CALL that the peer answered with a CALLERROR. */
export class SimulatorCallError extends SimulatorError {
	readonly action: string;
	readonly messageId: string;
	readonly ocppErrorCode: string;
	readonly errorDescription: string;
	readonly errorDetails: JsonObject;

	constructor(options: {
		action: string;
		messageId: string;
		ocppErrorCode: string;
		errorDescription: string;
		errorDetails: JsonObject;
	}) {
		super('call-error', `CALLERROR for ${options.action}: ${options.ocppErrorCode}`);
		this.name = 'SimulatorCallError';
		this.action = options.action;
		this.messageId = options.messageId;
		this.ocppErrorCode = options.ocppErrorCode;
		this.errorDescription = options.errorDescription;
		this.errorDetails = options.errorDetails;
	}
}

/** A CALL blocked by the injected outbound validator. */
export class SimulatorValidationError extends SimulatorError {
	readonly action: string;
	readonly errors: readonly string[];

	constructor(action: string, errors: readonly string[]) {
		super('validation-blocked', `Outbound ${action} failed schema validation`);
		this.name = 'SimulatorValidationError';
		this.action = action;
		this.errors = errors;
	}
}

/** True when a pending CALL already counted this failure. */
export function isAlreadyCountedError(error: unknown): boolean {
	return (
		error instanceof SimulatorError &&
		(error.code === 'call-error' ||
			error.code === 'timeout' ||
			error.code === 'send-failed' ||
			error.code === 'invalid-response' ||
			error.code === 'validation-blocked' ||
			error.code === 'disconnected' ||
			error.code === 'cancelled')
	);
}

/** Converts an unknown thrown value into a stable event/log snapshot. */
export function errorSnapshot(error: unknown): SimulatorErrorSnapshot {
	if (error instanceof SimulatorValidationError) {
		return {
			name: error.name,
			code: error.code,
			message: error.message,
			details: { action: error.action, errors: [...error.errors] },
		};
	}
	if (error instanceof SimulatorCallError) {
		return {
			name: error.name,
			code: error.code,
			message: error.message,
			details: {
				action: error.action,
				messageId: error.messageId,
				ocppErrorCode: error.ocppErrorCode,
				errorDescription: error.errorDescription,
				errorDetails: error.errorDetails,
			},
		};
	}
	if (error instanceof SimulatorError) {
		return {
			name: error.name,
			code: error.code,
			message: error.message,
			...(error.cause === undefined ? {} : { cause: describeCause(error.cause) }),
			...(error.details === undefined ? {} : { details: error.details }),
		};
	}
	if (error instanceof Error) {
		return {
			name: error.name,
			code: 'internal-error',
			message: error.message,
		};
	}
	return {
		name: 'Error',
		code: 'internal-error',
		message: 'An unknown error occurred',
	};
}

function describeCause(cause: unknown): string {
	if (cause instanceof Error) {
		return cause.message;
	}
	return typeof cause === 'string' ? cause : 'Unknown cause';
}
