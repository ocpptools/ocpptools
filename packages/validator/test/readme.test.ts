// SPDX-License-Identifier: Apache-2.0
// SPDX-FileCopyrightText: 2026 Rodolfo Carrillo

import { describe, expect, it } from 'vitest';

import { createSchemaRegistry, createValidator } from '../src/index.js';

const requestSchema = {
	type: 'object',
	properties: {},
	additionalProperties: false,
};

const responseSchema = {
	type: 'object',
	required: ['currentTime'],
	properties: { currentTime: { type: 'string' } },
};

describe('README examples', () => {
	it('validates frames and payloads with a custom registry', async () => {
		const schemas = {
			get(action: string, kind: 'request' | 'response') {
				if (action !== 'Heartbeat') return undefined;
				return kind === 'request' ? requestSchema : responseSchema;
			},
		};
		const validator = createValidator({ version: '2.0.1', schemas });

		await expect(validator.validateFrame([2, 'id-1', 'Heartbeat', {}])).resolves.toMatchObject({
			status: 'valid',
		});
		await expect(validator.validatePayload('Heartbeat', 'request', {})).resolves.toMatchObject({
			status: 'valid',
		});
		await expect(
			validator.validateFrame([3, 'id-1', { currentTime: '2026-01-01T00:00:00Z' }], {
				requestAction: 'Heartbeat',
			}),
		).resolves.toMatchObject({ status: 'valid' });
	});

	it('validates a frame with the official schemas package', async () => {
		const schemas = createSchemaRegistry({
			version: '2.0.1',
			files: ['2.0.1/HeartbeatRequest.json'],
			load: async (fileName) => {
				if (fileName !== 'HeartbeatRequest.json') return undefined;
				const specifier = '@ocpptools/schemas/2.0.1/HeartbeatRequest.json';
				const module = (await import(/* @vite-ignore */ specifier, {
					with: { type: 'json' },
				})) as { default?: unknown };
				if (module.default === undefined) {
					throw new Error('The schema module has no default export');
				}
				return module.default;
			},
		});
		const validator = createValidator({ version: '2.0.1', schemas });

		await expect(validator.validateFrame([2, 'id-1', 'Heartbeat', {}])).resolves.toMatchObject({
			status: 'valid',
		});
	});

	it('validates a frame with a registry built from file names', async () => {
		const schemas = createSchemaRegistry({
			version: '2.0.1',
			files: ['HeartbeatRequest.json'],
			load: (fileName) => (fileName === 'HeartbeatRequest.json' ? requestSchema : undefined),
		});
		const validator = createValidator({ version: '2.0.1', schemas });

		await expect(validator.validateFrame('[2,"id-1","Heartbeat",{}]')).resolves.toMatchObject({
			status: 'valid',
		});
	});
});
