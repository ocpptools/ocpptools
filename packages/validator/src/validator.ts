// SPDX-License-Identifier: Apache-2.0
// SPDX-FileCopyrightText: 2026 Rodolfo Carrillo

import type { ValidateFunction } from 'ajv';

import { MESSAGE_TYPE, inspectFrame } from '@ocpptools/core';
import type { FrameInspection, FrameIssue, MessageId, MessageType } from '@ocpptools/core';
import { normalizeSchema } from '@ocpptools/schema-utils';

import { createAjv } from './ajv.js';
import { pointerFromPath, schemaIssue, toValidationIssues } from './issues.js';
import { SchemaLoadError } from './registry.js';
import type {
	CreateValidatorOptions,
	PayloadKind,
	ValidateFrameOptions,
	ValidationIssue,
	ValidationResult,
	Validator,
} from './types.js';
import { assertOcppVersion } from './version.js';

class SchemaInvalidError extends Error {
	readonly reason: string;

	constructor(reason: string) {
		super(reason);
		this.name = 'SchemaInvalidError';
		this.reason = reason;
	}
}

function isModuleNamespace(value: unknown): boolean {
	if (typeof value !== 'object' || value === null) {
		return false;
	}
	try {
		if (Object.prototype.toString.call(value) === '[object Module]') {
			return true;
		}
		return (
			Object.hasOwn(value, '__esModule') && (value as { __esModule?: unknown }).__esModule === true
		);
	} catch {
		return false;
	}
}

function hasUnsafePropertyName(schema: unknown): boolean {
	if (typeof schema !== 'object' || schema === null) {
		return false;
	}
	if (Array.isArray(schema)) {
		return schema.some(hasUnsafePropertyName);
	}
	const record = schema as Record<string, unknown>;
	const properties = record['properties'];
	if (
		typeof properties === 'object' &&
		properties !== null &&
		!Array.isArray(properties) &&
		Object.hasOwn(properties, '__proto__')
	) {
		return true;
	}
	const required = record['required'];
	if (Array.isArray(required) && required.includes('__proto__')) {
		return true;
	}
	return Object.values(record).some(hasUnsafePropertyName);
}

function loadFailureMessage(action: string, kind: PayloadKind, error: unknown): string {
	if (error instanceof SchemaLoadError) {
		const cause = error.cause;
		const detail = cause instanceof Error && cause.message !== '' ? `: ${cause.message}` : '';
		return `${error.message}${detail}`;
	}
	if (error instanceof Error && error.message !== '') {
		return `Could not load the schema for ${action} (${kind}): ${error.message}`;
	}
	return `Could not load the schema for ${action} (${kind})`;
}

function schemaMissing(action: string, kind: PayloadKind, error: unknown): ValidationResult {
	const code = error instanceof SchemaInvalidError ? 'schema-invalid' : 'schema-load-failed';
	const message =
		error instanceof SchemaInvalidError
			? `The schema for ${action} (${kind}) is not valid: ${error.reason}`
			: loadFailureMessage(action, kind, error);
	return {
		status: 'schema-missing',
		valid: false,
		action,
		issues: [schemaIssue(code, message)],
		warnings: [],
	};
}

function invalidJson(): ValidationResult {
	return {
		status: 'invalid-frame',
		valid: false,
		issues: [
			{
				code: 'invalid-json',
				path: [],
				pointer: '',
				message: 'The input is not valid JSON',
				expected: 'valid JSON',
			},
		],
		warnings: [],
	};
}

function actionFromFrame(frame: unknown): string | undefined {
	try {
		if (!Array.isArray(frame)) {
			return undefined;
		}
		const action = (frame as readonly unknown[])[2];
		return typeof action === 'string' && action !== '' ? action : undefined;
	} catch {
		return undefined;
	}
}

function unreadableFrame(): ValidationResult {
	return {
		status: 'invalid-frame',
		valid: false,
		issues: [
			{
				code: 'not-array',
				path: [],
				pointer: '',
				message: 'The frame could not be read as a JSON array',
				expected: 'array',
				received: 'unreadable value',
			},
		],
		warnings: [],
	};
}

function toFrameIssue(issue: FrameIssue): ValidationIssue {
	return {
		code: issue.code,
		path: issue.path,
		pointer: pointerFromPath(issue.path),
		message: issue.message,
		expected: issue.expected,
		received: issue.received,
	};
}

function frameWarnings(inspection: FrameInspection): ValidationIssue[] {
	return inspection.issues
		.filter((issue) => issue.severity === 'warning')
		.map((issue) => toFrameIssue(issue));
}

function frameErrors(inspection: FrameInspection): ValidationIssue[] {
	return inspection.issues
		.filter((issue) => issue.severity === 'error')
		.map((issue) => toFrameIssue(issue));
}

function identityFor(inspection: FrameInspection): {
	messageType?: MessageType;
	messageId?: MessageId;
} {
	return {
		...(inspection.messageType === undefined ? {} : { messageType: inspection.messageType }),
		...(inspection.messageId === undefined ? {} : { messageId: inspection.messageId }),
	};
}

function prefixIssue(issue: ValidationIssue, prefix: 2 | 3): ValidationIssue {
	if (issue.code !== 'schema-violation') {
		return issue;
	}
	const path = [prefix, ...issue.path];
	return { ...issue, path, pointer: pointerFromPath(path) };
}

function mergePayloadResult(
	result: ValidationResult,
	prefix: 2 | 3,
	identity: { messageType?: MessageType; messageId?: MessageId },
	warnings: readonly ValidationIssue[],
): ValidationResult {
	const mergedWarnings = [...warnings, ...result.warnings];
	if (result.status === 'valid') {
		return { ...result, ...identity, warnings: mergedWarnings };
	}
	return {
		...result,
		...identity,
		issues: result.issues.map((issue) => prefixIssue(issue, prefix)),
		warnings: mergedWarnings,
	};
}

function uncheckedResult(): ValidationIssue {
	return {
		code: 'unchecked-result',
		path: [2],
		pointer: '/2',
		message:
			'The CALLRESULT payload was not checked: pass the request action as requestAction to check it',
	};
}

/**
 * Creates a validator for one OCPP version. Schemas are loaded and compiled on
 * first use, and a failed load or compilation is not cached, so the next call
 * tries again. It throws when `version` is not supported.
 */
export function createValidator(options: CreateValidatorOptions): Validator {
	const { schemas, version } = options;
	assertOcppVersion(version);
	const ajv = createAjv();
	const cache = new Map<string, Promise<ValidateFunction | undefined>>();

	const compile = (action: string, kind: PayloadKind): Promise<ValidateFunction | undefined> => {
		const key = `${kind}\u0000${action}`;
		const known = cache.get(key);
		if (known !== undefined) {
			return known;
		}
		const pending = (async (): Promise<ValidateFunction | undefined> => {
			const schema = await schemas.get(action, kind);
			if (schema === undefined) {
				// Do not cache a miss: a custom registry may learn about the action later.
				cache.delete(key);
				return undefined;
			}
			if (isModuleNamespace(schema)) {
				throw new SchemaInvalidError(
					'The registry returned a module namespace; return its default export',
				);
			}
			let normalized;
			try {
				normalized = normalizeSchema(schema, {
					defaultDraft: version === '1.6' ? 'draft-04' : 'draft-06',
					stripUnknownKeywords: true,
				});
			} catch (error) {
				throw new SchemaInvalidError(
					error instanceof Error && error.message !== ''
						? error.message
						: 'The schema could not be normalized',
				);
			}
			if (!normalized.ok) {
				throw new SchemaInvalidError(normalized.error.message);
			}
			if (hasUnsafePropertyName(normalized.value.schema)) {
				throw new SchemaInvalidError('The schema uses "__proto__" as a property name');
			}
			try {
				return ajv.compile(normalized.value.schema);
			} catch (error) {
				throw new SchemaInvalidError(
					error instanceof Error && error.message !== ''
						? error.message
						: 'The schema could not be compiled',
				);
			}
		})();
		cache.set(key, pending);
		pending.catch(() => {
			cache.delete(key);
		});
		return pending;
	};

	const validatePayload = async (
		action: string,
		kind: PayloadKind,
		payload: unknown,
	): Promise<ValidationResult> => {
		let validate: ValidateFunction | undefined;
		try {
			validate = await compile(action, kind);
		} catch (error) {
			return schemaMissing(action, kind, error);
		}
		if (validate === undefined) {
			return {
				status: 'unknown-action',
				valid: false,
				action,
				issues: [],
				warnings: [],
			};
		}
		let valid: boolean;
		try {
			valid = validate(payload);
		} catch {
			return schemaMissing(
				action,
				kind,
				new SchemaInvalidError('The schema could not validate the payload'),
			);
		}
		if (valid) {
			return { status: 'valid', valid: true, action, issues: [], warnings: [] };
		}
		try {
			return {
				status: 'invalid-payload',
				valid: false,
				action,
				issues: toValidationIssues(validate.errors, payload),
				warnings: [],
			};
		} catch {
			// A hostile payload must not turn a validation result into a rejection.
			return {
				status: 'invalid-payload',
				valid: false,
				action,
				issues: [],
				warnings: [],
			};
		}
	};

	return {
		version,
		validatePayload,
		async validateFrame(input, options?: ValidateFrameOptions) {
			let requestAction: unknown;
			try {
				requestAction = options?.requestAction;
			} catch {
				requestAction = undefined;
			}
			let frame: unknown;
			if (typeof input === 'string') {
				try {
					frame = JSON.parse(input) as unknown;
				} catch {
					return invalidJson();
				}
			} else {
				frame = input;
			}

			let inspection: FrameInspection;
			try {
				inspection = inspectFrame(frame, { version });
			} catch {
				return unreadableFrame();
			}

			const warnings = frameWarnings(inspection);
			const errors = frameErrors(inspection);
			const identity = identityFor(inspection);
			if (errors.length > 0) {
				const action =
					inspection.messageType === MESSAGE_TYPE.CALL ? actionFromFrame(frame) : undefined;
				return {
					status: 'invalid-frame',
					valid: false,
					...identity,
					...(action === undefined ? {} : { action }),
					issues: errors,
					warnings,
				};
			}

			const frameArray = frame as readonly unknown[];
			if (inspection.messageType === MESSAGE_TYPE.CALL) {
				let action: unknown;
				let payload: unknown;
				try {
					action = frameArray[2];
					payload = frameArray[3];
				} catch {
					return unreadableFrame();
				}
				if (typeof action !== 'string' || action === '') {
					return unreadableFrame();
				}
				const result = await validatePayload(action, 'request', payload);
				return mergePayloadResult(result, 3, identity, warnings);
			}
			if (inspection.messageType === MESSAGE_TYPE.CALLRESULT) {
				let payload: unknown;
				try {
					payload = frameArray[2];
				} catch {
					return unreadableFrame();
				}
				if (typeof requestAction === 'string' && requestAction !== '') {
					const result = await validatePayload(requestAction, 'response', payload);
					return mergePayloadResult(result, 2, identity, warnings);
				}
				return {
					status: 'valid',
					valid: true,
					...identity,
					issues: [],
					warnings: [...warnings, uncheckedResult()],
				};
			}
			if (inspection.messageType === MESSAGE_TYPE.CALLERROR) {
				return {
					status: 'valid',
					valid: true,
					...identity,
					issues: [],
					warnings,
				};
			}
			return unreadableFrame();
		},
	};
}
