// SPDX-License-Identifier: Apache-2.0
// SPDX-FileCopyrightText: 2026 Rodolfo Carrillo

import { describe, expect, it } from 'vitest';

import { parseFrame } from '@ocpptools/core';
import { createValidator } from '@ocpptools/validator';

import { createBuilder, type BuilderSchemaRegistry } from '../src/index.js';

async function loadJson(fileName: string): Promise<unknown> {
	const specifier = `@ocpptools/schemas/${fileName}`;
	const module = (await import(/* @vite-ignore */ specifier, {
		with: { type: 'json' },
	})) as { default?: unknown };
	if (module.default === undefined) throw new Error(`${specifier} has no default export`);
	return module.default;
}

function registry(version: '1.6' | '2.0.1'): BuilderSchemaRegistry {
	return {
		get(action, kind) {
			const request = version === '1.6' ? `${action}.json` : `${action}Request.json`;
			return loadJson(`${version}/${kind === 'request' ? request : `${action}Response.json`}`);
		},
	};
}

describe('builder with the official schema package', () => {
	it('builds a valid 1.6J BootNotification', async () => {
		const builder = createBuilder({ version: '1.6', schemas: registry('1.6') });
		const built = await builder.buildPayload('BootNotification', {
			chargePointVendor: 'Acme',
			chargePointModel: 'AC-7',
		});
		expect(built.ok).toBe(true);
		if (!built.ok) return;
		const validator = createValidator({ version: '1.6', schemas: registry('1.6') });
		await expect(
			validator.validatePayload('BootNotification', 'request', built.value),
		).resolves.toMatchObject({ status: 'valid', valid: true });
	});

	it('builds a valid 2.0.1 BootNotification and serializes it', async () => {
		const builder = createBuilder({
			version: '2.0.1',
			schemas: registry('2.0.1'),
			messageIds: () => 'id-real',
		});
		const call = await builder.buildCall('BootNotification', {
			reason: 'PowerUp',
			chargingStation: {
				model: 'AC-22',
				vendorName: 'Acme',
				firmwareVersion: '2.0.0',
			},
		});
		expect(call.ok).toBe(true);
		if (!call.ok) return;
		const validator = createValidator({ version: '2.0.1', schemas: registry('2.0.1') });
		await expect(
			validator.validatePayload('BootNotification', 'request', call.value[3]),
		).resolves.toMatchObject({ status: 'valid', valid: true });
		expect(builder.serialize(call.value)).toMatchObject({ ok: true });
		const serialized = builder.serialize(call.value);
		if (serialized.ok) {
			expect(parseFrame(serialized.value).ok).toBe(true);
		}
	});

	it('builds a valid 2.0.1 TransactionEvent through refs', async () => {
		const builder = createBuilder({ version: '2.0.1', schemas: registry('2.0.1') });
		const built = await builder.buildPayload('TransactionEvent', {
			eventType: 'Started',
			timestamp: '2026-01-10T12:00:00Z',
			triggerReason: 'Authorized',
			seqNo: 1,
			transactionInfo: { transactionId: 'txn-1', chargingState: 'Charging' },
		});
		expect(built.ok).toBe(true);
		if (!built.ok) return;
		const validator = createValidator({ version: '2.0.1', schemas: registry('2.0.1') });
		await expect(
			validator.validatePayload('TransactionEvent', 'request', built.value),
		).resolves.toMatchObject({ status: 'valid', valid: true });
	});

	it('describes fields from a real 2.0.1 schema', async () => {
		const builder = createBuilder({ version: '2.0.1', schemas: registry('2.0.1') });
		const fields = await builder.fields('GetVariables', {
			omit: (path) => path[path.length - 1] === 'customData',
		});
		expect(fields.ok).toBe(true);
		if (!fields.ok) return;
		expect(fields.value.children?.some((field) => field.name === 'getVariableData')).toBe(true);
	});
});
