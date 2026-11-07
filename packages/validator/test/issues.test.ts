// SPDX-License-Identifier: Apache-2.0
// SPDX-FileCopyrightText: 2026 Rodolfo Carrillo

import type { ErrorObject } from 'ajv';
import { describe, expect, it } from 'vitest';

import { schemaIssue, toValidationIssues } from '../src/issues.js';

function error(
	keyword: string,
	instancePath = '',
	params: Record<string, unknown> = {},
): ErrorObject {
	return { keyword, instancePath, params, schemaPath: '#', message: 'message' };
}

describe('toValidationIssues', () => {
	it('returns no issues when Ajv reports no errors', () => {
		expect(toValidationIssues(null, {})).toEqual([]);
		expect(toValidationIssues(undefined, {})).toEqual([]);
	});

	it('keeps the path, pointer, message, expected, and received value', () => {
		const issues = toValidationIssues([error('type', '/a~1b/c~0d/0', { type: 'string' })], {
			'a/b': { 'c~d': [1] },
		});
		expect(issues).toEqual([
			{
				code: 'schema-violation',
				path: ['a/b', 'c~d', 0],
				pointer: '/a~1b/c~0d/0',
				message: 'The value must be a string',
				keyword: 'type',
				expected: 'a string',
				received: '1',
			},
		]);
	});

	it('adds the missing property to a required error', () => {
		const issue = toValidationIssues([error('required', '', { missingProperty: 'id' })], {})[0];
		expect(issue).toMatchObject({
			path: ['id'],
			pointer: '/id',
			message: 'The property "id" is required',
			keyword: 'required',
			expected: 'required',
			received: 'missing',
		});
	});

	it('adds the extra property to an additionalProperties error', () => {
		const issue = toValidationIssues(
			[error('additionalProperties', '', { additionalProperty: 'extra' })],
			{ extra: true },
		)[0];
		expect(issue).toMatchObject({
			path: ['extra'],
			pointer: '/extra',
			message: 'The property "extra" is not allowed',
			keyword: 'additionalProperties',
			expected: 'no additional properties',
			received: 'true',
		});
	});

	it('does not add a property when its name is not text', () => {
		const required = toValidationIssues([error('required', '', { missingProperty: 1 })], {})[0];
		const additional = toValidationIssues(
			[error('additionalProperties', '', { additionalProperty: 1 })],
			{},
		)[0];
		expect(required?.path).toEqual([]);
		expect(additional?.path).toEqual([]);
	});

	it('describes every supported keyword', () => {
		const cases: [string, Record<string, unknown>, string | undefined][] = [
			['additionalItems', {}, 'no additional items'],
			['additionalProperties', { additionalProperty: 'extra' }, 'no additional properties'],
			['const', { allowedValue: 1 }, 'the allowed value'],
			['enum', { allowedValues: [1, 2] }, 'one of the allowed values'],
			['exclusiveMaximum', { limit: 5 }, 'less than 5'],
			['exclusiveMinimum', { limit: 1 }, 'greater than 1'],
			['format', { format: 'date-time' }, 'a valid date-time'],
			['maxItems', { limit: 2 }, 'at most 2 items'],
			['maxLength', { limit: 3 }, 'at most 3 characters'],
			['maximum', { limit: 5 }, 'at most 5'],
			['minItems', { limit: 1 }, 'at least 1 item'],
			['minLength', { limit: 2 }, 'at least 2 characters'],
			['minimum', { limit: 0 }, 'at least 0'],
			['multipleOf', { multipleOf: 0.1 }, 'a multiple of 0.1'],
			['pattern', { pattern: '^a$' }, 'a string matching ^a$'],
			['required', { missingProperty: 'id' }, 'required'],
			['type', { type: 'string' }, 'a string'],
			['type', { type: 'object' }, 'an object'],
			['type', { type: 'array' }, 'an array'],
			['type', { type: 'integer' }, 'an integer'],
			['type', { type: 'null' }, 'null'],
			['type', { type: ['string', 'null'] }, 'a string or null'],
			['uniqueItems', {}, 'a list of unique items'],
			['not-a-known-keyword', {}, undefined],
		];

		for (const [keyword, params, expected] of cases) {
			const issue = toValidationIssues([error(keyword, '', params)], {})[0];
			expect(issue?.expected).toBe(expected);
		}
	});

	it('shows primitive values, kinds, and missing values', () => {
		const cases: [string, unknown, string][] = [
			['/null', null, 'null'],
			['/array', [], 'array'],
			['/object', {}, 'object'],
			['/bigint', 1n, 'bigint'],
			['/boolean', false, 'false'],
			['/number', 2, '2'],
			['/string', 'x', '"x"'],
			['/missing', undefined, 'missing'],
		];

		for (const [path, value, received] of cases) {
			const payload = path === '/missing' ? {} : { [path.slice(1)]: value };
			const issue = toValidationIssues([error('type', path, { type: 'string' })], payload)[0];
			expect(issue?.received).toBe(received);
		}
	});

	it('uses missing when the path leaves the payload', () => {
		const issue = toValidationIssues([error('type', '/a/b', { type: 'string' })], { a: 1 })[0];
		expect(issue?.received).toBe('missing');
		const root = toValidationIssues([error('type', '/x', { type: 'string' })], null)[0];
		expect(root?.received).toBe('missing');
	});

	it('truncates a long received string', () => {
		const issue = toValidationIssues([error('type', '/id', { type: 'number' })], {
			id: 'x'.repeat(50),
		})[0];
		expect(issue?.received).toHaveLength(40);
		expect(issue?.received?.endsWith('…')).toBe(true);
	});

	it('uses an empty pointer for the root', () => {
		const issue = toValidationIssues([error('type', '', { type: 'string' })], null)[0];
		expect(issue?.path).toEqual([]);
		expect(issue?.pointer).toBe('');
	});

	it('sorts by path and then by keyword', () => {
		const payload = { a: [0, 1], b: 0, c: 0 };
		const issues = toValidationIssues(
			[
				error('type', '/c', { type: 'string' }),
				error('type', '/a/1', { type: 'string' }),
				error('type', '/b', { type: 'string' }),
				error('type', '/a', { type: 'string' }),
				error('type', '/a/0', { type: 'string' }),
			],
			payload,
		);
		expect(issues.map((issue) => issue.pointer)).toEqual(['/a', '/a/0', '/a/1', '/b', '/c']);

		const samePath = toValidationIssues(
			[error('type', '/a', { type: 'string' }), error('enum', '/a', { allowedValues: [1] })],
			{ a: 1 },
		);
		expect(samePath.map((issue) => issue.keyword)).toEqual(['enum', 'type']);
	});

	it('uses a clear message for additionalItems', () => {
		const issue = toValidationIssues([error('additionalItems', '', { limit: 1 })], ['a', 'b'])[0];
		expect(issue).toMatchObject({
			expected: 'no additional items',
			message: 'The array has more items than allowed',
			received: 'array',
		});
	});

	it('leaves the message generic for an unknown keyword', () => {
		const issue = toValidationIssues([error('not-a-known-keyword')], {})[0];
		expect(issue?.message).toBe('The value does not satisfy the "not-a-known-keyword" rule');
	});
});

describe('schemaIssue', () => {
	it('describes a schema problem with an empty path', () => {
		expect(schemaIssue('schema-invalid', 'invalid')).toEqual({
			code: 'schema-invalid',
			path: [],
			pointer: '',
			message: 'invalid',
		});
		expect(schemaIssue('schema-load-failed', 'failed')).toEqual({
			code: 'schema-load-failed',
			path: [],
			pointer: '',
			message: 'failed',
		});
	});
});
