// SPDX-License-Identifier: Apache-2.0
// SPDX-FileCopyrightText: 2026 Rodolfo Carrillo

import { describe, expect, it } from 'vitest';

import { createValidator } from '@ocpptools/validator';

import { createFrameFactory } from '../src/frames/factory.js';

async function loadJson(fileName: string): Promise<unknown> {
	const specifier = `@ocpptools/schemas/${fileName}`;
	const module = (await import(/* @vite-ignore */ specifier, {
		with: { type: 'json' },
	})) as { default?: unknown };
	if (module.default === undefined) throw new Error(`${specifier} has no default export`);
	return module.default;
}

describe('real schema data at runtime', () => {
	it('validates a frame built by the factory with the official 2.0.1 schema', async () => {
		const schema = await loadJson('2.0.1/HeartbeatRequest.json');
		const validator = createValidator({
			version: '2.0.1',
			schemas: {
				get: (action, kind) => (action === 'Heartbeat' && kind === 'request' ? schema : undefined),
			},
		});
		const frames = createFrameFactory({ version: '2.0.1' });
		const call = frames.call('Heartbeat', {});
		await expect(validator.validatePayload(call[2], 'request', call[3])).resolves.toMatchObject({
			status: 'valid',
			valid: true,
		});
	});
});
