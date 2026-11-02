// SPDX-License-Identifier: Apache-2.0
// SPDX-FileCopyrightText: 2026 Rodolfo Carrillo

// The guarantees in the "normalized schema contract" section of the README.
// Every schema here is written for the test.

import { describe, expect, it } from 'vitest';

import { cloneJson } from '../src/clone.js';
import {
	applyDefaults,
	createEmptyPayload,
	getFields,
	normalizeSchema,
	resolveRefs,
	type JsonValue,
	type ResolvedJsonSchema,
} from '../src/index.js';

const DRAFT_07 = 'http://json-schema.org/draft-07/schema#';

interface Fixture {
	readonly name: string;
	readonly schema: unknown;
	readonly source: 'draft-04' | 'draft-06' | 'draft-07';
	readonly defaultDraft?: 'draft-04' | 'draft-06';
}

const fixtures: readonly Fixture[] = [
	{
		name: 'draft-04',
		source: 'draft-04',
		schema: {
			$schema: 'http://json-schema.org/draft-04/schema#',
			id: 'urn:example:contract:legacy',
			type: 'object',
			definitions: {
				Id: { type: 'string', maxLength: 36 },
				Level: { type: 'integer', minimum: 0, exclusiveMinimum: true, default: 1 },
			},
			properties: {
				id: { $ref: '#/definitions/Id' },
				type: { type: 'string', enum: ['A', 'B'] },
				level: { $ref: '#/definitions/Level' },
				tags: { type: 'array', items: { $ref: '#/definitions/Id' }, minItems: 1 },
				meta: { type: 'object', default: { id: 'kept' }, javaType: 'Meta' },
			},
			required: ['id', 'type'],
			additionalProperties: false,
		},
	},
	{
		name: 'draft-06',
		source: 'draft-06',
		schema: {
			$schema: 'http://json-schema.org/draft-06/schema#',
			$id: 'urn:example:contract:modern',
			type: 'object',
			definitions: { Flag: { type: 'boolean', default: false } },
			properties: {
				on: { $ref: '#/definitions/Flag' },
				ratio: { type: 'number', exclusiveMinimum: 0, exclusiveMaximum: 1 },
				pair: { type: 'array', items: [{ type: 'string' }, { $ref: '#/definitions/Flag' }] },
			},
			required: ['on'],
		},
	},
	{
		name: 'draft-07',
		source: 'draft-07',
		schema: {
			$schema: 'http://json-schema.org/draft-07/schema#',
			type: 'object',
			properties: {
				name: { type: ['string', 'null'], default: null },
				nested: { type: 'object', properties: { n: { type: 'integer', default: 2 } } },
			},
			required: ['nested'],
		},
	},
	{
		name: 'no $schema, read as draft-04',
		source: 'draft-04',
		defaultDraft: 'draft-04',
		schema: {
			id: 'urn:example:contract:assumed',
			type: 'object',
			properties: { v: { type: 'number', maximum: 9, exclusiveMaximum: true } },
		},
	},
];

function deepFreeze<T>(value: T): T {
	if (typeof value === 'object' && value !== null) {
		for (const entry of Object.values(value)) {
			deepFreeze(entry);
		}
		Object.freeze(value);
	}
	return value;
}

function objectsIn(value: unknown, found = new Set<object>()): Set<object> {
	if (typeof value === 'object' && value !== null) {
		found.add(value);
		for (const entry of Object.values(value)) {
			objectsIn(entry, found);
		}
	}
	return found;
}

function normalized(fixture: Fixture) {
	const result = normalizeSchema(fixture.schema, { defaultDraft: fixture.defaultDraft });
	if (!result.ok) {
		throw new Error(result.error.message);
	}
	return result.value;
}

function resolved(fixture: Fixture): ResolvedJsonSchema {
	const result = resolveRefs(normalized(fixture).schema, { dropDefinitions: true });
	if (!result.ok) {
		throw new Error(result.error.message);
	}
	return result.value;
}

describe.each(fixtures)('the contract, for $name', (fixture) => {
	it('normalizes to plain JSON in draft-07 vocabulary', () => {
		const { schema, draft, warnings } = normalized(fixture);
		expect(draft).toBe(fixture.source);
		expect(warnings).toEqual([]);
		expect(cloneJson(schema)).toEqual({ ok: true, value: schema });
		const text = JSON.stringify(schema);
		expect(text).not.toMatch(/"exclusive(Minimum|Maximum)":(true|false)/);
		if (fixture.source !== 'draft-07') {
			expect((schema as { $schema: string }).$schema).toBe(DRAFT_07);
			expect('id' in (schema as object)).toBe(false);
		}
	});

	it('normalizes twice to the same result', () => {
		const once = normalized(fixture).schema;
		const twice = normalizeSchema(once);
		expect(twice).toMatchObject({
			ok: true,
			value: { schema: once, draft: 'draft-07', warnings: [] },
		});
	});

	it('gives a schema with no $ref', () => {
		expect(JSON.stringify(resolved(fixture))).not.toContain('"$ref"');
	});

	it('is stable: the same input gives an equal result', () => {
		expect(normalized(fixture)).toEqual(normalized(fixture));
		expect(resolved(fixture)).toEqual(resolved(fixture));
	});

	it('accepts a frozen input, and shares no object with it or with another result', () => {
		const input = deepFreeze(JSON.parse(JSON.stringify(fixture.schema)) as unknown);
		const first = normalizeSchema(input, { defaultDraft: fixture.defaultDraft });
		const second = normalizeSchema(input, { defaultDraft: fixture.defaultDraft });
		if (!first.ok || !second.ok) {
			throw new Error('unreachable');
		}
		const inputObjects = objectsIn(input);
		const firstObjects = objectsIn(first.value.schema);
		const secondObjects = objectsIn(second.value.schema);
		expect([...firstObjects].filter((object) => inputObjects.has(object))).toEqual([]);
		expect([...firstObjects].filter((object) => secondObjects.has(object))).toEqual([]);

		const refs = resolveRefs(first.value.schema);
		if (!refs.ok) {
			throw new Error('unreachable');
		}
		const refObjects = objectsIn(refs.value);
		expect([...refObjects].filter((object) => firstObjects.has(object))).toEqual([]);
	});

	it('describes the schema and builds payloads without throwing', () => {
		const schema = resolved(fixture);
		expect(getFields(schema).kind).toBe('object');
		const empty = createEmptyPayload(schema);
		expect(empty).toBeTypeOf('object');
		expect(cloneJson(empty)).toEqual({ ok: true, value: empty });
		const filled = applyDefaults(schema, empty);
		expect(filled.ok).toBe(true);
		const again = applyDefaults(schema, (filled as { value: JsonValue }).value);
		expect(again).toEqual(filled);
	});
});

describe('the contract, for what cannot be converted', () => {
	it('returns a schema with an unsupported draft unchanged, with a warning', () => {
		const schema = { $schema: 'https://json-schema.org/draft/2020-12/schema', id: 'stays' };
		const result = normalizeSchema(schema);
		expect(result).toMatchObject({ ok: true, value: { schema, draft: 'unknown' } });
		expect(result.ok && result.value.warnings.map((warning) => warning.code)).toEqual([
			'unknown-draft',
		]);
	});

	it('reports problems as results with a kind, a message, and a path', () => {
		const failures = [
			normalizeSchema(undefined),
			resolveRefs({ properties: { a: { $ref: 'other.json' } } }),
			resolveRefs({ properties: { a: { $ref: '#/definitions/Missing' } } }),
			resolveRefs({ $ref: '#' }),
			applyDefaults(true, undefined),
		];
		for (const failure of failures) {
			expect(failure.ok).toBe(false);
			expect(failure).toMatchObject({
				error: {
					kind: expect.any(String) as string,
					message: expect.any(String) as string,
					path: expect.any(Array) as unknown[],
				},
			});
		}
	});
});
