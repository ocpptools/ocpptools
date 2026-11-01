// SPDX-License-Identifier: Apache-2.0
// SPDX-FileCopyrightText: 2026 Rodolfo Carrillo

import { describe, expect, it } from 'vitest';

import {
	DEFAULT_MAX_DEPTH,
	MAX_DEPTH_LIMIT,
	resolveRefs,
	type ResolveOptions,
} from '../src/resolve.js';
import type { ResolvedJsonSchema } from '../src/types.js';

function resolved(schema: unknown, options?: ResolveOptions): ResolvedJsonSchema {
	const result = resolveRefs(schema, options);
	if (!result.ok) {
		throw new Error(`Expected a resolved schema: ${result.error.kind}: ${result.error.message}`);
	}
	return result.value;
}

function failure(schema: unknown, options?: ResolveOptions) {
	const result = resolveRefs(schema, options);
	if (result.ok) {
		throw new Error('Expected an error');
	}
	return result.error;
}

function deepFreeze<T>(value: T): T {
	if (typeof value === 'object' && value !== null) {
		for (const child of Object.values(value)) {
			deepFreeze(child);
		}
		Object.freeze(value);
	}
	return value;
}

/** A property that refers to D0, which refers to D1, and so on to a plain string. */
function chain(length: number): unknown {
	const definitions: Record<string, unknown> = {};
	for (let index = 0; index < length; index++) {
		definitions[`D${String(index)}`] =
			index === length - 1 ? { type: 'string' } : { $ref: `#/definitions/D${String(index + 1)}` };
	}
	return { definitions, properties: { value: { $ref: '#/definitions/D0' } } };
}

describe('resolveRefs without references', () => {
	it('returns an equal copy', () => {
		const schema = {
			type: 'object',
			properties: { a: { type: 'string' }, b: { type: 'array', items: { type: 'number' } } },
			required: ['a'],
		};
		const result = resolved(schema);
		expect(result).toEqual(schema);
		expect(result).not.toBe(schema);
	});

	it('accepts a boolean schema', () => {
		expect(resolved(true)).toBe(true);
		expect(resolved(false)).toBe(false);
	});
});

describe('resolveRefs with local references', () => {
	it('inlines a definition', () => {
		const result = resolved({
			definitions: { Name: { type: 'string', maxLength: 5 } },
			type: 'object',
			properties: { name: { $ref: '#/definitions/Name' } },
		});
		expect(result).toEqual({
			definitions: { Name: { type: 'string', maxLength: 5 } },
			type: 'object',
			properties: { name: { type: 'string', maxLength: 5 } },
		});
	});

	it('follows a chain of references longer than six', () => {
		const result = resolved(chain(10), { dropDefinitions: true });
		expect(result).toEqual({ properties: { value: { type: 'string' } } });
	});

	it('inlines a definition inside a definition', () => {
		const result = resolved(
			{
				definitions: {
					Id: { type: 'string', maxLength: 36 },
					Evse: { type: 'object', properties: { id: { $ref: '#/definitions/Id' } } },
				},
				properties: { evse: { $ref: '#/definitions/Evse' } },
			},
			{ dropDefinitions: true },
		);
		expect(result).toEqual({
			properties: {
				evse: { type: 'object', properties: { id: { type: 'string', maxLength: 36 } } },
			},
		});
	});

	it('resolves a deeply nested structure built from definitions', () => {
		const levels = 13;
		const definitions: Record<string, unknown> = {};
		for (let level = 0; level < levels; level++) {
			definitions[`L${String(level)}`] =
				level === levels - 1
					? { type: 'string' }
					: {
							type: 'object',
							properties: { next: { $ref: `#/definitions/L${String(level + 1)}` } },
						};
		}
		let expected: unknown = { type: 'string' };
		for (let level = levels - 2; level >= 0; level--) {
			expected = { type: 'object', properties: { next: expected } };
		}
		const result = resolved(
			{ definitions, properties: { root: { $ref: '#/definitions/L0' } } },
			{ dropDefinitions: true },
		);
		expect(result).toEqual({ properties: { root: expected } });
	});

	it('replaces a schema that has $ref with its target and ignores its other keywords', () => {
		const result = resolved({
			definitions: { Name: { type: 'string' } },
			properties: { name: { $ref: '#/definitions/Name', description: 'ignored', maxLength: 1 } },
		});
		expect((result as { properties: unknown }).properties).toEqual({ name: { type: 'string' } });
	});

	it('inlines references in every schema position', () => {
		const ref = { $ref: '#/definitions/S' };
		const result = resolved(
			{
				definitions: { S: { type: 'string' } },
				properties: { p: ref },
				patternProperties: { '^x': ref },
				dependencies: { a: ref, b: ['a'] },
				additionalProperties: ref,
				additionalItems: ref,
				items: [ref, true, ref],
				allOf: [ref, true],
				anyOf: [ref],
				oneOf: [ref],
				not: ref,
				contains: ref,
				propertyNames: ref,
				if: ref,
				then: ref,
				else: ref,
			},
			{ dropDefinitions: true },
		);
		const s = { type: 'string' };
		expect(result).toEqual({
			properties: { p: s },
			patternProperties: { '^x': s },
			dependencies: { a: s, b: ['a'] },
			additionalProperties: s,
			additionalItems: s,
			items: [s, true, s],
			allOf: [s, true],
			anyOf: [s],
			oneOf: [s],
			not: s,
			contains: s,
			propertyNames: s,
			if: s,
			then: s,
			else: s,
		});
	});

	it('inlines a single items schema', () => {
		const result = resolved({
			definitions: { S: { type: 'string' } },
			items: { $ref: '#/definitions/S' },
		});
		expect((result as { items: unknown }).items).toEqual({ type: 'string' });
	});

	it('follows a reference to a boolean schema', () => {
		const result = resolved(
			{
				definitions: { Any: true, None: false },
				properties: { a: { $ref: '#/definitions/Any' }, b: { $ref: '#/definitions/None' } },
			},
			{ dropDefinitions: true },
		);
		expect(result).toEqual({ properties: { a: true, b: false } });
	});

	it('follows a reference to a place that is not under definitions', () => {
		const result = resolved({
			properties: {
				a: { type: 'integer' },
				b: { $ref: '#/properties/a' },
				c: { $ref: '#/allOf/0' },
			},
			allOf: [{ type: 'null' }],
		});
		expect((result as { properties: unknown }).properties).toEqual({
			a: { type: 'integer' },
			b: { type: 'integer' },
			c: { type: 'null' },
		});
	});

	it('reads escaped and percent-encoded pointers', () => {
		const result = resolved(
			{
				definitions: {
					'a/b': { const: 'slash' },
					'c~d': { const: 'tilde' },
					'e f': { const: 'space' },
					'g%h': { const: 'percent' },
				},
				properties: {
					one: { $ref: '#/definitions/a~1b' },
					two: { $ref: '#/definitions/c~0d' },
					three: { $ref: '#/definitions/e%20f' },
					four: { $ref: '#/definitions/g%25h' },
				},
			},
			{ dropDefinitions: true },
		);
		expect(result).toEqual({
			properties: {
				one: { const: 'slash' },
				two: { const: 'tilde' },
				three: { const: 'space' },
				four: { const: 'percent' },
			},
		});
	});

	it('does not read $ref in data, or a property that is called $ref', () => {
		const schema = {
			properties: { $ref: { type: 'string' }, other: { type: 'number' } },
			default: { $ref: '#/nowhere' },
			enum: [{ $ref: 'other.json' }],
			examples: [{ $ref: '#/missing' }],
			vendorKeyword: { $ref: 5 },
			required: ['$ref'],
		};
		expect(resolved(schema)).toEqual(schema);
	});

	it('does not reach the prototype chain', () => {
		for (const name of ['toString', 'constructor', 'hasOwnProperty']) {
			const error = failure({ properties: { a: { $ref: `#/definitions/${name}` } } });
			expect(error).toMatchObject({ kind: 'unresolved-ref', path: ['properties', 'a'] });
		}
	});

	it('treats __proto__ as an ordinary definition name', () => {
		const schema: unknown = JSON.parse(
			'{"definitions":{"__proto__":{"type":"string"}},"properties":{"a":{"$ref":"#/definitions/__proto__"},"__proto__":{"type":"number"}}}',
		);
		const result = resolved(schema, { dropDefinitions: true });
		const properties = (result as { properties: object }).properties;
		expect(Object.getPrototypeOf(properties)).toBe(Object.prototype);
		expect(Object.keys(properties)).toEqual(['a', '__proto__']);
		expect(Object.getOwnPropertyDescriptor(properties, 'a')?.value).toEqual({ type: 'string' });
		expect(Object.getOwnPropertyDescriptor(properties, '__proto__')?.value).toEqual({
			type: 'number',
		});
	});
});

describe('resolveRefs keeps the result apart', () => {
	it('gives each use of a definition its own copy', () => {
		const result = resolved(
			{
				definitions: { Kind: { type: 'string', enum: ['a', 'b'] } },
				properties: { x: { $ref: '#/definitions/Kind' }, y: { $ref: '#/definitions/Kind' } },
			},
			{ dropDefinitions: true },
		) as { properties: { x: { enum: string[] }; y: { enum: string[] } } };
		expect(result.properties.x).toEqual(result.properties.y);
		expect(result.properties.x).not.toBe(result.properties.y);
		expect(result.properties.x.enum).not.toBe(result.properties.y.enum);
		result.properties.x.enum.push('c');
		expect(result.properties.y.enum).toEqual(['a', 'b']);
	});

	it('does not share data with a definition that is kept', () => {
		const result = resolved({
			definitions: { Kind: { enum: ['a'], dependencies: { k: ['m'] } } },
			properties: { x: { $ref: '#/definitions/Kind' } },
		}) as {
			definitions: { Kind: { enum: string[]; dependencies: { k: string[] } } };
			properties: { x: { enum: string[]; dependencies: { k: string[] } } };
		};
		expect(result.properties.x.enum).not.toBe(result.definitions.Kind.enum);
		expect(result.properties.x.dependencies.k).not.toBe(result.definitions.Kind.dependencies.k);
	});

	it('accepts a frozen input and leaves it intact', () => {
		const input = deepFreeze({
			definitions: { S: { type: 'string', enum: ['a'] } },
			properties: { s: { $ref: '#/definitions/S' } },
		});
		const before = JSON.stringify(input);
		const result = resolved(input);
		expect(JSON.stringify(input)).toBe(before);
		expect(result).not.toBe(input);
	});
});

describe('resolveRefs with dropDefinitions', () => {
	it('removes definitions at every level but still follows references into them', () => {
		const result = resolved(
			{
				definitions: { Top: { type: 'string' } },
				properties: {
					nested: {
						type: 'object',
						definitions: { Inner: { type: 'number' } },
						properties: {
							a: { $ref: '#/definitions/Top' },
							b: { $ref: '#/properties/nested/definitions/Inner' },
						},
					},
				},
			},
			{ dropDefinitions: true },
		);
		expect(result).toEqual({
			properties: {
				nested: { type: 'object', properties: { a: { type: 'string' }, b: { type: 'number' } } },
			},
		});
	});

	it('does not check definitions that nothing refers to', () => {
		const result = resolved(
			{
				definitions: {
					Broken: { $ref: '#/definitions/Missing' },
					Loop: { properties: { next: { $ref: '#/definitions/Loop' } } },
				},
				type: 'object',
			},
			{ dropDefinitions: true },
		);
		expect(result).toEqual({ type: 'object' });
	});

	it('checks definitions when they are kept', () => {
		const schema = { definitions: { Broken: { $ref: '#/definitions/Missing' } }, type: 'object' };
		expect(failure(schema)).toMatchObject({
			kind: 'unresolved-ref',
			path: ['definitions', 'Broken'],
			ref: '#/definitions/Missing',
		});
	});

	it('keeps the definitions by default', () => {
		const result = resolved({ definitions: { S: { type: 'string' } } });
		expect(result).toEqual({ definitions: { S: { type: 'string' } } });
	});
});

describe('resolveRefs errors', () => {
	it('reports a reference to nothing', () => {
		expect(failure({ properties: { a: { $ref: '#/definitions/Missing' } } })).toEqual({
			kind: 'unresolved-ref',
			message: expect.stringContaining('#/definitions/Missing') as string,
			path: ['properties', 'a'],
			ref: '#/definitions/Missing',
		});
	});

	it('reports a reference to something that is not a schema', () => {
		const schema = {
			minimum: 1,
			enum: ['a'],
			properties: { a: { $ref: '#/minimum' }, b: { $ref: '#/enum' } },
		};
		const error = failure(schema);
		expect(error).toMatchObject({
			kind: 'unresolved-ref',
			path: ['properties', 'a'],
			ref: '#/minimum',
		});
		expect(error.message).toContain('not point to a schema');
		expect(failure({ enum: ['a'], properties: { b: { $ref: '#/enum' } } }).message).toContain(
			'not point to a schema',
		);
		expect(failure({ enum: [null], properties: { b: { $ref: '#/enum/0' } } }).kind).toBe(
			'unresolved-ref',
		);
	});

	it('reports a reference outside the document', () => {
		for (const ref of [
			'other.json',
			'other.json#/definitions/A',
			'http://example.com/s#/a',
			'urn:x:y',
			'',
		]) {
			expect(failure({ properties: { a: { $ref: ref } } })).toMatchObject({
				kind: 'external-ref',
				path: ['properties', 'a'],
				ref,
			});
		}
	});

	it('reports a malformed pointer or an anchor', () => {
		for (const ref of ['#foo', '#definitions/A', '#/definitions/a%', '#/definitions/a~2', '#/a~']) {
			expect(failure({ allOf: [{ $ref: ref }] })).toMatchObject({
				kind: 'invalid-pointer',
				path: ['allOf', 0],
				ref,
			});
		}
	});

	it('reports a $ref that is not a string, without a ref in the error', () => {
		for (const ref of [5, null, true, { a: 1 }, ['#']]) {
			const error = failure({ properties: { a: { $ref: ref } } });
			expect(error).toEqual({
				kind: 'invalid-schema',
				message: expect.stringContaining('must be a string') as string,
				path: ['properties', 'a'],
			});
			expect('ref' in error).toBe(false);
		}
	});

	it('reports only the first error', () => {
		const error = failure({
			properties: { a: { $ref: '#/definitions/One' }, b: { $ref: '#/definitions/Two' } },
			allOf: [{ $ref: 'other.json' }],
		});
		expect(error).toMatchObject({ kind: 'unresolved-ref', ref: '#/definitions/One' });
	});
});

describe('resolveRefs with circular references', () => {
	it('rejects a reference to the root', () => {
		expect(failure({ $ref: '#' })).toMatchObject({ kind: 'circular-ref', path: [], ref: '#' });
		expect(failure({ properties: { a: { $ref: '#' } } })).toMatchObject({
			kind: 'circular-ref',
			path: ['properties', 'a'],
		});
	});

	it('rejects a definition that refers to itself', () => {
		const schema = {
			definitions: { A: { $ref: '#/definitions/A' } },
			properties: { a: { $ref: '#/definitions/A' } },
		};
		expect(failure(schema, { dropDefinitions: true })).toMatchObject({
			kind: 'circular-ref',
			path: ['definitions', 'A'],
			ref: '#/definitions/A',
		});
	});

	it('rejects two definitions that refer to each other', () => {
		const schema = {
			definitions: { A: { $ref: '#/definitions/B' }, B: { $ref: '#/definitions/A' } },
			properties: { a: { $ref: '#/definitions/A' } },
		};
		const error = failure(schema, { dropDefinitions: true });
		expect(error.kind).toBe('circular-ref');
		expect(error.path).toEqual(['definitions', 'B']);
	});

	it('rejects a recursive structure, such as a tree', () => {
		const schema = {
			definitions: {
				Tree: {
					type: 'object',
					properties: { children: { type: 'array', items: { $ref: '#/definitions/Tree' } } },
				},
			},
			properties: { tree: { $ref: '#/definitions/Tree' } },
		};
		expect(failure(schema, { dropDefinitions: true })).toMatchObject({
			kind: 'circular-ref',
			path: ['definitions', 'Tree', 'properties', 'children', 'items'],
		});
	});

	it('rejects a reference to a schema that contains it', () => {
		const schema = {
			properties: { a: { type: 'object', properties: { b: { $ref: '#/properties/a' } } } },
		};
		expect(failure(schema)).toMatchObject({
			kind: 'circular-ref',
			path: ['properties', 'a', 'properties', 'b'],
		});
	});

	it('accepts a reference to a sibling and to a schema used twice', () => {
		const schema = {
			definitions: { S: { type: 'string' } },
			properties: {
				a: { $ref: '#/definitions/S' },
				b: { $ref: '#/properties/a' },
				c: { allOf: [{ $ref: '#/definitions/S' }, { $ref: '#/definitions/S' }] },
			},
		};
		const s = { type: 'string' };
		expect(
			(resolved(schema, { dropDefinitions: true }) as { properties: unknown }).properties,
		).toEqual({
			a: s,
			b: s,
			c: { allOf: [s, s] },
		});
	});

	it('accepts a schema whose definitions only share a target', () => {
		const result = resolved(
			{
				definitions: {
					Leaf: { type: 'string' },
					A: { $ref: '#/definitions/Leaf' },
					B: { $ref: '#/definitions/Leaf' },
				},
				allOf: [{ $ref: '#/definitions/A' }, { $ref: '#/definitions/B' }],
			},
			{ dropDefinitions: true },
		);
		expect(result).toEqual({ allOf: [{ type: 'string' }, { type: 'string' }] });
	});
});

describe('resolveRefs limits', () => {
	it('allows a chain of references up to maxDepth and no further', () => {
		expect(resolved(chain(10), { dropDefinitions: true, maxDepth: 11 })).toEqual({
			properties: { value: { type: 'string' } },
		});
		expect(failure(chain(10), { dropDefinitions: true, maxDepth: 10 })).toMatchObject({
			kind: 'limit-exceeded',
		});
	});

	it('has a default maxDepth', () => {
		expect(DEFAULT_MAX_DEPTH).toBe(128);
		expect(resolved(chain(DEFAULT_MAX_DEPTH - 1), { dropDefinitions: true })).toBeTypeOf('object');
		const error = failure(chain(DEFAULT_MAX_DEPTH), { dropDefinitions: true });
		expect(error).toMatchObject({ kind: 'limit-exceeded' });
		expect(error.message).toContain(String(DEFAULT_MAX_DEPTH));
		expect('ref' in error).toBe(false);
	});

	it('does not honor a maxDepth above the ceiling', () => {
		expect(MAX_DEPTH_LIMIT).toBe(256);
		expect(
			resolved(chain(MAX_DEPTH_LIMIT - 1), { dropDefinitions: true, maxDepth: 1e9 }),
		).toBeTypeOf('object');
		expect(
			failure(chain(MAX_DEPTH_LIMIT + 50), { dropDefinitions: true, maxDepth: 1e9 }),
		).toMatchObject({
			kind: 'limit-exceeded',
		});
	});

	it('stops a schema whose references fan out', () => {
		const definitions: Record<string, unknown> = {};
		for (let index = 0; index < 30; index++) {
			const next = { $ref: `#/definitions/F${String(index + 1)}` };
			definitions[`F${String(index)}`] = { allOf: [next, next] };
		}
		definitions.F30 = { type: 'string' };
		const schema = { definitions, allOf: [{ $ref: '#/definitions/F0' }] };
		const error = failure(schema, { dropDefinitions: true });
		expect(error.kind).toBe('limit-exceeded');
		expect(error.message).toContain('100000');
	});

	it('honors maxNodes', () => {
		const schema = {
			definitions: { S: { type: 'string' } },
			properties: { a: { $ref: '#/definitions/S' }, b: { $ref: '#/definitions/S' } },
		};
		expect(resolved(schema, { dropDefinitions: true, maxNodes: 8 })).toBeTypeOf('object');
		expect(failure(schema, { dropDefinitions: true, maxNodes: 4 })).toMatchObject({
			kind: 'limit-exceeded',
		});
	});

	it('ignores limits that are not positive integers', () => {
		const schema = {
			definitions: { S: { type: 'string' } },
			properties: { a: { $ref: '#/definitions/S' } },
		};
		for (const bad of [0, -1, 1.5, NaN, Infinity]) {
			expect(resolved(schema, { maxDepth: bad, maxNodes: bad, dropDefinitions: true })).toEqual({
				properties: { a: { type: 'string' } },
			});
		}
	});
});

describe('resolveRefs with input that is not a schema', () => {
	it('rejects values that are not objects or booleans', () => {
		for (const value of [null, 0, 'text', [], [{}]]) {
			expect(failure(value)).toEqual({
				kind: 'invalid-schema',
				message: expect.stringContaining('object or a boolean') as string,
				path: [],
			});
		}
	});

	it('rejects values that are not JSON, with their path', () => {
		expect(failure(undefined)).toMatchObject({ kind: 'invalid-schema', path: [] });
		expect(failure({ properties: { a: { default: undefined } } })).toMatchObject({
			kind: 'invalid-schema',
			path: ['properties', 'a', 'default'],
		});
	});

	it('rejects a circular object', () => {
		const schema: Record<string, unknown> = { type: 'object' };
		schema.properties = { self: schema };
		expect(failure(schema)).toMatchObject({
			kind: 'invalid-schema',
			path: ['properties', 'self'],
		});
	});
});
