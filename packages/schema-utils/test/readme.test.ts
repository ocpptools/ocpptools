// SPDX-License-Identifier: Apache-2.0
// SPDX-FileCopyrightText: 2026 Rodolfo Carrillo

// Runs the example in the package README. Keep the two in sync.

import { describe, expect, it } from 'vitest';

import {
	applyDefaults,
	createEmptyPayload,
	getFields,
	normalizeSchema,
	resolveRefs,
} from '../src/index.js';

const heater = {
	$schema: 'http://json-schema.org/draft-04/schema#',
	id: 'urn:example:heater',
	type: 'object',
	definitions: { Mode: { type: 'string', enum: ['eco', 'boost'], default: 'eco' } },
	properties: {
		mode: { $ref: '#/definitions/Mode' },
		target: { type: 'number', minimum: 5, exclusiveMinimum: true, maximum: 30 },
	},
	required: ['mode', 'target'],
};

describe('the README pipeline', () => {
	it('normalizes a draft-04 schema', () => {
		const normalized = normalizeSchema(heater);
		if (!normalized.ok) throw new Error(normalized.error.message);
		expect(normalized.value.draft).toBe('draft-04');
		expect(normalized.value.schema).toMatchObject({
			$schema: 'http://json-schema.org/draft-07/schema#',
			$id: 'urn:example:heater',
			properties: { target: { exclusiveMinimum: 5, maximum: 30 } },
		});
		expect('id' in (normalized.value.schema as object)).toBe(false);
		const target = (normalized.value.schema as { properties: { target: object } }).properties
			.target;
		expect('minimum' in target).toBe(false);
	});

	it('resolves, describes, and builds payloads', () => {
		const normalized = normalizeSchema(heater);
		if (!normalized.ok) throw new Error(normalized.error.message);

		const resolved = resolveRefs(normalized.value.schema, { dropDefinitions: true });
		if (!resolved.ok) throw new Error(resolved.error.message);
		const schema = resolved.value;

		const root = getFields(schema);
		expect(root.children?.map((field) => [field.name, field.kind, field.required])).toEqual([
			['mode', 'string', true],
			['target', 'number', true],
		]);

		expect(createEmptyPayload(schema)).toEqual({ mode: 'eco' });
		expect(applyDefaults(schema, { target: 21 })).toEqual({
			ok: true,
			value: { target: 21, mode: 'eco' },
		});
	});
});
