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

function loadFailureMessage(action: string, kind: PayloadKind, error: unknown): string {
	return error instanceof SchemaLoadError
		? error.message
		: `Could not load the schema for ${action} (${kind})`;
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
			const normalized = normalizeSchema(schema, { stripUnknownKeywords: true });
			if (!normalized.ok) {
				throw new SchemaInvalidError(normalized.error.message);
			}
			try {
				return ajv.compile(normalized.value.schema);
			} catch {
				throw new SchemaInvalidError('The schema could not be compiled');
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
			return {
				status: 'invalid-payload',
				valid: false,
				action,
				issues: toValidationIssues(validate.errors, payload),
				warnings: [],
			};
		},
	};
}
