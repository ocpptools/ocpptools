// SPDX-License-Identifier: Apache-2.0
// SPDX-FileCopyrightText: 2026 Rodolfo Carrillo

import type { FrameIssueCode } from '@ocpptools/core';
import { describe, expect, expectTypeOf, it } from 'vitest';

import type {
	InvalidResult,
	SchemaRegistry,
	ValidResult,
	ValidationIssue,
	ValidationIssueCode,
	ValidationResult,
	ValidationStatus,
	ValidateFrameOptions,
	Validator,
} from '../src/index.js';

describe('types', () => {
	it('narrows a result by its status', () => {
		const describeResult = (result: ValidationResult): string => {
			if (result.status === 'valid') {
				expectTypeOf(result).toEqualTypeOf<ValidResult>();
				expectTypeOf(result.valid).toEqualTypeOf<true>();
				return 'valid';
			}
			expectTypeOf(result).toEqualTypeOf<InvalidResult>();
			expectTypeOf(result.valid).toEqualTypeOf<false>();
			expectTypeOf(result.status).toEqualTypeOf<Exclude<ValidationStatus, 'valid'>>();
			return result.status;
		};
		expect(describeResult({ status: 'valid', valid: true, issues: [], warnings: [] })).toBe(
			'valid',
		);
		expect(
			describeResult({ status: 'unknown-action', valid: false, issues: [], warnings: [] }),
		).toBe('unknown-action');
	});

	it('narrows a result by valid', () => {
		const result = { status: 'valid', valid: true, issues: [], warnings: [] } as ValidationResult;
		if (result.valid) {
			expectTypeOf(result).toEqualTypeOf<ValidResult>();
		}
		expect(result.valid).toBe(true);
	});

	it('does not allow a valid status with valid false', () => {
		// @ts-expect-error `valid` and `status` must agree
		const wrong: ValidationResult = { status: 'valid', valid: false, issues: [], warnings: [] };
		expect(wrong.valid).toBe(false);
	});

	it('accepts the frame codes of core and its own codes', () => {
		expectTypeOf<FrameIssueCode>().toExtend<ValidationIssueCode>();
		const codes: ValidationIssueCode[] = [
			'wrong-length',
			'invalid-json',
			'schema-invalid',
			'schema-load-failed',
			'unchecked-result',
			'schema-violation',
		];
		expect(codes).toHaveLength(6);
	});

	it('describes an issue with an optional keyword, expected, and received', () => {
		const minimal: ValidationIssue = {
			code: 'invalid-json',
			path: [],
			pointer: '',
			message: 'The input is not valid JSON',
		};
		const full: ValidationIssue = {
			code: 'schema-violation',
			path: [3, 'idTag'],
			pointer: '/3/idTag',
			message: 'must be at most 20 characters',
			keyword: 'maxLength',
			expected: 'at most 20 characters',
			received: '25 characters',
		};
		expectTypeOf(full.path).toEqualTypeOf<readonly (string | number)[]>();
		expect([minimal.keyword, full.keyword]).toEqual([undefined, 'maxLength']);
	});

	it('types the frame method and its options', () => {
		expectTypeOf<ValidateFrameOptions>().toEqualTypeOf<{
			readonly requestAction?: string;
		}>();
		expectTypeOf<Validator['validateFrame']>().parameters.toEqualTypeOf<
			[input: unknown, options?: ValidateFrameOptions]
		>();
		expectTypeOf<Validator['validateFrame']>().returns.toEqualTypeOf<Promise<ValidationResult>>();
	});

	it('lets a registry answer with a value or a promise', async () => {
		const sync: SchemaRegistry = { get: () => ({ type: 'object' }) };
		const async: SchemaRegistry = { get: () => Promise.resolve(undefined) };
		expectTypeOf<SchemaRegistry['get']>().parameters.toEqualTypeOf<
			[action: string, kind: 'request' | 'response']
		>();
		expect(sync.get('Heartbeat', 'request')).toEqual({ type: 'object' });
		expect(await async.get('Heartbeat', 'response')).toBeUndefined();
	});
});
