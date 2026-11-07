// SPDX-License-Identifier: Apache-2.0
// SPDX-FileCopyrightText: 2026 Rodolfo Carrillo

import type { ErrorObject } from 'ajv';

import type { ValidationIssue } from './types.js';

const MAX_RECEIVED_LENGTH = 40;

type PathSegment = string | number;

function isJsonObject(value: unknown): value is Record<string, unknown> {
	return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function decodeSegment(segment: string): string {
	return segment.replace(/~1/g, '/').replace(/~0/g, '~');
}

function encodeSegment(segment: PathSegment): string {
	return String(segment).replace(/~/g, '~0').replace(/\//g, '~1');
}

function pathFromPointer(pointer: string, payload: unknown): PathSegment[] {
	if (pointer === '') {
		return [];
	}
	const path: PathSegment[] = [];
	let current = payload;
	for (const encoded of pointer.slice(1).split('/')) {
		const decoded = decodeSegment(encoded);
		if (Array.isArray(current)) {
			const index = Number(decoded);
			path.push(index);
			current = current[index];
		} else {
			path.push(decoded);
			current = isJsonObject(current) ? current[decoded] : undefined;
		}
	}
	return path;
}

function pointerFromPath(path: readonly PathSegment[]): string {
	return path.length === 0 ? '' : `/${path.map(encodeSegment).join('/')}`;
}

function valueAtPath(payload: unknown, path: readonly PathSegment[]): unknown {
	let current = payload;
	for (const segment of path) {
		if (Array.isArray(current) && typeof segment === 'number') {
			current = current[segment];
		} else if (isJsonObject(current) && typeof segment === 'string') {
			current = current[segment];
		} else {
			return undefined;
		}
	}
	return current;
}

/** A short text for a received value: its JSON when it is a primitive, otherwise its kind. */
function showValue(value: unknown): string {
	if (value === undefined) {
		return 'missing';
	}
	if (value === null) {
		return 'null';
	}
	if (typeof value === 'string' || typeof value === 'number' || typeof value === 'boolean') {
		const text = String(JSON.stringify(value));
		return text.length > MAX_RECEIVED_LENGTH ? `${text.slice(0, MAX_RECEIVED_LENGTH - 1)}…` : text;
	}
	if (Array.isArray(value)) {
		return 'array';
	}
	return typeof value === 'object' ? 'object' : typeof value;
}

function countWithUnit(limit: unknown, unit: string): string {
	const count = Number(limit);
	return `${String(limit)} ${unit}${count === 1 ? '' : 's'}`;
}

function typeDescription(type: unknown): string {
	const types = Array.isArray(type) ? type.map(String) : [String(type)];
	return types
		.map((name) => {
			switch (name) {
				case 'array':
					return 'an array';
				case 'integer':
					return 'an integer';
				case 'null':
					return 'null';
				case 'object':
					return 'an object';
				default:
					return `a ${name}`;
			}
		})
		.join(' or ');
}

function propertyName(error: ErrorObject, params: Record<string, unknown>): string | undefined {
	if (error.keyword === 'required') {
		const missing = params['missingProperty'];
		return typeof missing === 'string' ? missing : undefined;
	}
	if (error.keyword === 'additionalProperties') {
		const additional = params['additionalProperty'];
		return typeof additional === 'string' ? additional : undefined;
	}
	return undefined;
}

function expectedFor(error: ErrorObject, params: Record<string, unknown>): string | undefined {
	switch (error.keyword) {
		case 'additionalItems':
			return 'no additional items';
		case 'additionalProperties':
			return 'no additional properties';
		case 'const':
			return 'the allowed value';
		case 'enum':
			return 'one of the allowed values';
		case 'exclusiveMaximum':
			return `less than ${String(params['limit'])}`;
		case 'exclusiveMinimum':
			return `greater than ${String(params['limit'])}`;
		case 'format':
			return `a valid ${String(params['format'])}`;
		case 'maxItems':
			return `at most ${countWithUnit(params['limit'], 'item')}`;
		case 'maxLength':
			return `at most ${countWithUnit(params['limit'], 'character')}`;
		case 'maximum':
			return `at most ${String(params['limit'])}`;
		case 'minItems':
			return `at least ${countWithUnit(params['limit'], 'item')}`;
		case 'minLength':
			return `at least ${countWithUnit(params['limit'], 'character')}`;
		case 'minimum':
			return `at least ${String(params['limit'])}`;
		case 'multipleOf':
			return `a multiple of ${String(params['multipleOf'])}`;
		case 'pattern':
			return `a string matching ${String(params['pattern'])}`;
		case 'required':
			return 'required';
		case 'type':
			return typeDescription(params['type']);
		case 'uniqueItems':
			return 'a list of unique items';
		default:
			return undefined;
	}
}

function messageFor(error: ErrorObject, property: string | undefined): string {
	if (error.keyword === 'required') {
		return `The property ${JSON.stringify(String(property))} is required`;
	}
	if (error.keyword === 'additionalProperties') {
		return `The property ${JSON.stringify(String(property))} is not allowed`;
	}
	const expected = expectedFor(error, error.params as Record<string, unknown>);
	return expected === undefined
		? `The value does not satisfy the "${error.keyword}" rule`
		: `The value must be ${expected}`;
}

function comparePaths(left: readonly PathSegment[], right: readonly PathSegment[]): number {
	const length = Math.min(left.length, right.length);
	for (let index = 0; index < length; index += 1) {
		const first = left[index] as PathSegment;
		const second = right[index] as PathSegment;
		if (first === second) {
			continue;
		}
		if (typeof first === 'number' && typeof second === 'number') {
			return first - second;
		}
		if (typeof first === 'number') {
			return -1;
		}
		if (typeof second === 'number') {
			return 1;
		}
		return first < second ? -1 : 1;
	}
	return left.length - right.length;
}

function compareIssues(left: ValidationIssue, right: ValidationIssue): number {
	const path = comparePaths(left.path, right.path);
	if (path !== 0) {
		return path;
	}
	const first = left.keyword ?? '';
	const second = right.keyword ?? '';
	return first < second ? -1 : first > second ? 1 : 0;
}

function toIssue(error: ErrorObject, payload: unknown): ValidationIssue {
	const params = error.params as Record<string, unknown>;
	const property = propertyName(error, params);
	const base = pathFromPointer(error.instancePath, payload);
	const path = property === undefined ? base : [...base, property];
	const expected = expectedFor(error, params);
	return {
		code: 'schema-violation',
		path,
		pointer: pointerFromPath(path),
		message: messageFor(error, property),
		keyword: error.keyword,
		...(expected === undefined ? {} : { expected }),
		received: showValue(valueAtPath(payload, path)),
	};
}

/**
 * Converts the errors of Ajv into the stable issue model of the package. The
 * path is relative to `payload`, the pointer follows RFC 6901, and the order is
 * stable: by path, then by keyword.
 */
export function toValidationIssues(
	errors: readonly ErrorObject[] | null | undefined,
	payload: unknown,
): ValidationIssue[] {
	if (errors === null || errors === undefined) {
		return [];
	}
	return errors.map((error) => toIssue(error, payload)).sort(compareIssues);
}

/** A problem with the schema itself, not with the payload. */
export function schemaIssue(
	code: 'schema-invalid' | 'schema-load-failed',
	message: string,
): ValidationIssue {
	return { code, path: [], pointer: '', message };
}
