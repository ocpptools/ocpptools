// SPDX-License-Identifier: Apache-2.0
// SPDX-FileCopyrightText: 2026 Rodolfo Carrillo

import type { ValidateFunction } from 'ajv';

import { normalizeSchema } from '@ocpptools/schema-utils';

import { createAjv } from './ajv.js';
import { schemaIssue, toValidationIssues } from './issues.js';
import { SchemaLoadError } from './registry.js';
import type { CreateValidatorOptions, PayloadKind, ValidationResult, Validator } from './types.js';

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

/**
 * Creates a validator for one OCPP version. Schemas are loaded and compiled on
 * first use, and a failed load or compilation is not cached, so the next call
 * tries again.
 */
export function createValidator(options: CreateValidatorOptions): Validator {
	const { schemas, version } = options;
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

	return {
		version,
		async validatePayload(action, kind, payload) {
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
		},
	};
}
