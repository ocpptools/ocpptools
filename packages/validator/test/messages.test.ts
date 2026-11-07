// SPDX-License-Identifier: Apache-2.0
// SPDX-FileCopyrightText: 2026 Rodolfo Carrillo

import { describe, expect, it } from 'vitest';

import { normalizeSchema, resolveRefs } from '@ocpptools/schema-utils';

import { createSchemaRegistry, schemaFileName } from '../src/registry.js';
import type { PayloadKind, Validator } from '../src/types.js';
import { createValidator } from '../src/validator.js';
import { minimalPayload } from './helpers/minimal-payload.js';

type Version = '1.6' | '2.0.1';
type JsonObject = Record<string, unknown>;

interface Manifest {
	readonly files: Record<string, string>;
}

interface Entry {
	readonly path: string;
	readonly version: Version;
	readonly action: string;
	readonly kind: PayloadKind;
	readonly schema: unknown;
	readonly resolved: unknown;
}

function resolveForTest(schema: unknown): unknown {
	const normalized = normalizeSchema(schema, { stripUnknownKeywords: true });
	if (!normalized.ok) {
		throw new Error(normalized.error.message);
	}
	const resolved = resolveRefs(normalized.value.schema);
	if (!resolved.ok) {
		throw new Error(resolved.error.message);
	}
	return resolved.value;
}

function isObject(value: unknown): value is JsonObject {
	return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function isManifest(value: unknown): value is Manifest {
	return isObject(value) && isObject(value['files']);
}

async function loadJson(fileName: string): Promise<unknown> {
	const specifier = `@ocpptools/schemas/${fileName}`;
	const module = (await import(/* @vite-ignore */ specifier, {
		with: { type: 'json' },
	})) as { default?: unknown };
	if (module.default === undefined) {
		throw new Error(`The module ${specifier} has no default export`);
	}
	return module.default;
}

function parsePath(path: string): Omit<Entry, 'schema' | 'resolved'> {
	const separator = path.indexOf('/');
	if (separator < 1) {
		throw new Error(`Unexpected schema path ${path}`);
	}
	const version = path.slice(0, separator);
	const file = path.slice(separator + 1);
	if (version !== '1.6' && version !== '2.0.1') {
		throw new Error(`Unexpected version in ${path}`);
	}
	const kind: PayloadKind = file.endsWith('Response.json') ? 'response' : 'request';
	const action = file
		.replace(/Request\.json$/, '')
		.replace(/Response\.json$/, '')
		.replace(/\.json$/, '');
	return { path, version, action, kind };
}

function clone<T>(value: T): T {
	return JSON.parse(JSON.stringify(value)) as T;
}

function typeOf(schema: unknown): string | undefined {
	if (!isObject(schema)) {
		return undefined;
	}
	const type = schema['type'];
	if (typeof type === 'string') {
		return type;
	}
	if (Array.isArray(type) && typeof type[0] === 'string') {
		return type[0];
	}
	return undefined;
}

function wrongValueFor(schema: unknown): unknown {
	switch (typeOf(schema)) {
		case 'array':
			return {};
		case 'boolean':
			return 'wrong';
		case 'integer':
		case 'number':
			return 'wrong';
		case 'null':
			return 'wrong';
		case 'object':
			return [];
		case 'string':
			return 1;
		default:
			return [];
	}
}

const manifest = await loadJson('manifest.json');
if (!isManifest(manifest)) {
	throw new Error('The schema manifest has no files');
}
const paths = Object.keys(manifest.files).sort();
const entries: Entry[] = await Promise.all(
	paths.map(async (path) => {
		const schema = await loadJson(path);
		return { ...parsePath(path), schema, resolved: resolveForTest(schema) };
	}),
);
const validators = new Map<Version, Validator>();

for (const version of ['1.6', '2.0.1'] as const) {
	const files = entries
		.filter((entry) => entry.version === version)
		.map((entry) => entry.path.slice(version.length + 1));
	const schemas = createSchemaRegistry({
		version,
		files,
		load: (fileName) => loadJson(`${version}/${fileName}`),
	});
	validators.set(version, createValidator({ version, schemas }));
}

function validatorFor(version: Version): Validator {
	const validator = validators.get(version);
	if (validator === undefined) {
		throw new Error(`No validator for ${version}`);
	}
	return validator;
}

function frameFor(entry: Pick<Entry, 'action' | 'kind'>, payload: unknown): unknown {
	return entry.kind === 'request' ? [2, 'id-1', entry.action, payload] : [3, 'id-1', payload];
}

function optionsFor(entry: Pick<Entry, 'action' | 'kind'>): { requestAction: string } | undefined {
	return entry.kind === 'response' ? { requestAction: entry.action } : undefined;
}

describe('the OCA schema corpus', () => {
	it('has the expected manifest coverage', () => {
		expect(entries).toHaveLength(184);
		expect(entries.filter((entry) => entry.version === '1.6')).toHaveLength(56);
		expect(entries.filter((entry) => entry.version === '2.0.1')).toHaveLength(128);

		const actions = new Map<Version, Set<string>>();
		const pairs = new Set<string>();
		for (const entry of entries) {
			const versionActions = actions.get(entry.version) ?? new Set<string>();
			versionActions.add(entry.action);
			actions.set(entry.version, versionActions);
			pairs.add(`${entry.version}/${entry.action}/${entry.kind}`);
			expect(schemaFileName(entry.version, entry.action, entry.kind)).toBe(
				entry.path.slice(entry.version.length + 1),
			);
		}
		expect(actions.get('1.6')?.size).toBe(28);
		expect(actions.get('2.0.1')?.size).toBe(64);
		expect(pairs.size).toBe(184);

		const responsePaths = new Set(
			entries
				.filter((entry) => entry.kind === 'response')
				.map((entry) => `${entry.version}/${entry.action}`),
		);
		for (const entry of entries.filter((candidate) => candidate.kind === 'request')) {
			expect(responsePaths.has(`${entry.version}/${entry.action}`)).toBe(true);
		}

		const rootObjects = entries.filter(
			(entry) => isObject(entry.resolved) && entry.resolved['type'] === 'object',
		);
		expect(rootObjects).toHaveLength(184);
		expect(
			rootObjects.filter(
				(entry) => isObject(entry.resolved) && entry.resolved['additionalProperties'] === false,
			),
		).toHaveLength(184);
	});

	it('has the expected untyped and required-free roots', () => {
		const noRequired = entries.filter((entry) => {
			if (!isObject(entry.resolved)) {
				throw new Error(`${entry.path} is not an object schema`);
			}
			const required = entry.resolved['required'];
			return !Array.isArray(required) || required.length === 0;
		});
		const noProperties = entries.filter((entry) => {
			if (!isObject(entry.resolved)) {
				throw new Error(`${entry.path} is not an object schema`);
			}
			return (
				!isObject(entry.resolved['properties']) ||
				Object.keys(entry.resolved['properties']).length === 0
			);
		});
		const noTypedProperty = entries.filter((entry) => {
			if (!isObject(entry.resolved) || !isObject(entry.resolved['properties'])) {
				return true;
			}
			return !Object.values(entry.resolved['properties']).some(
				(property) => typeOf(property) !== undefined,
			);
		});
		expect(noRequired).toHaveLength(36);
		expect(noProperties).toHaveLength(8);
		expect(noTypedProperty).toHaveLength(8);
	});

	it.each(entries.map((entry) => [entry.path, entry] as const))(
		'validates and rejects bad variants of %s',
		async (_path, entry) => {
			const validator = validatorFor(entry.version);
			const payload = minimalPayload(entry.schema);
			const base = await validator.validateFrame(frameFor(entry, payload), optionsFor(entry));
			expect(base.status).toBe('valid');
			expect(base.action).toBe(entry.action);
			expect(base.messageType).toBe(entry.kind === 'request' ? 2 : 3);
			expect(base.issues).toEqual([]);
			expect(base.warnings).toEqual([]);

			if (!isObject(entry.resolved)) {
				throw new Error(`${entry.path} is not an object schema`);
			}
			const required = entry.resolved['required'];
			if (Array.isArray(required) && required.length > 0) {
				const missing = clone(payload);
				if (!isObject(missing)) {
					throw new Error(`${entry.path} has a non-object minimal payload`);
				}
				delete missing[String(required[0])];
				const result = await validator.validatePayload(entry.action, entry.kind, missing);
				expect(result.status).toBe('invalid-payload');
				expect(result.issues.some((issue) => issue.keyword === 'required')).toBe(true);
			}

			const extra = clone(payload);
			if (!isObject(extra)) {
				throw new Error(`${entry.path} has a non-object minimal payload`);
			}
			extra['__unexpected'] = true;
			const extraResult = await validator.validatePayload(entry.action, entry.kind, extra);
			expect(extraResult.status).toBe('invalid-payload');
			expect(extraResult.issues.some((issue) => issue.keyword === 'additionalProperties')).toBe(
				true,
			);

			const properties = isObject(entry.resolved['properties'])
				? entry.resolved['properties']
				: undefined;
			let wrong = clone(payload);
			if (properties !== undefined) {
				const name = Object.keys(properties).find(
					(property) => typeOf(properties[property]) !== undefined,
				);
				if (name !== undefined) {
					if (!isObject(wrong)) {
						throw new Error(`${entry.path} has a non-object minimal payload`);
					}
					wrong[name] = wrongValueFor(properties[name]);
				} else {
					wrong = [];
				}
			} else {
				wrong = [];
			}
			const wrongResult = await validator.validatePayload(entry.action, entry.kind, wrong);
			expect(wrongResult.status).toBe('invalid-payload');
			expect(wrongResult.issues.some((issue) => issue.keyword === 'type')).toBe(true);
		},
	);

	it('accepts realistic examples from both versions', async () => {
		const examples: [Version, string, PayloadKind, unknown][] = [
			[
				'1.6',
				'BootNotification',
				'request',
				{ chargePointVendor: 'Acme', chargePointModel: 'Model' },
			],
			[
				'1.6',
				'BootNotification',
				'response',
				{ status: 'Accepted', currentTime: '2026-01-01T00:00:00Z', interval: 300 },
			],
			['1.6', 'Authorize', 'request', { idTag: 'ABC' }],
			[
				'1.6',
				'StartTransaction',
				'request',
				{
					connectorId: 1,
					idTag: 'ABC',
					meterStart: 0,
					timestamp: '2026-01-01T00:00:00Z',
				},
			],
			[
				'2.0.1',
				'BootNotification',
				'request',
				{ reason: 'PowerUp', chargingStation: { model: 'M', vendorName: 'V' } },
			],
			['2.0.1', 'Authorize', 'request', { idToken: { idToken: 'ABC', type: 'Central' } }],
			['2.0.1', 'Heartbeat', 'request', {}],
			['2.0.1', 'Heartbeat', 'response', { currentTime: '2026-01-01T00:00:00Z' }],
			[
				'2.0.1',
				'TransactionEvent',
				'request',
				{
					eventType: 'Started',
					timestamp: '2026-01-01T00:00:00Z',
					triggerReason: 'RemoteStart',
					seqNo: 1,
					transactionInfo: { transactionId: 'tx-1', chargingState: 'Charging' },
				},
			],
		];

		for (const [version, action, kind, payload] of examples) {
			const entry = { action, kind };
			const result = await validatorFor(version).validateFrame(
				frameFor(entry, payload),
				optionsFor(entry),
			);
			expect(result.status, `${version} ${action} ${kind}`).toBe('valid');
			expect(result.warnings).toEqual([]);
		}
	});

	it('accepts a decimal multipleOf value in SetChargingProfile', async () => {
		const payload = {
			connectorId: 1,
			csChargingProfiles: {
				chargingProfileId: 1,
				stackLevel: 0,
				chargingProfilePurpose: 'TxProfile',
				chargingProfileKind: 'Absolute',
				chargingSchedule: {
					chargingRateUnit: 'A',
					chargingSchedulePeriod: [{ startPeriod: 0, limit: 0.3 }],
				},
			},
		};
		const validator = validatorFor('1.6');
		await expect(
			validator.validatePayload('SetChargingProfile', 'request', payload),
		).resolves.toMatchObject({ status: 'valid' });

		const invalid = clone(payload);
		if (!isObject(invalid)) {
			throw new Error('The example is not an object');
		}
		const profile = invalid['csChargingProfiles'];
		if (!isObject(profile)) {
			throw new Error('The charging profile is not an object');
		}
		const schedule = profile['chargingSchedule'];
		if (!isObject(schedule)) {
			throw new Error('The charging schedule is not an object');
		}
		const periods = schedule['chargingSchedulePeriod'];
		if (!Array.isArray(periods) || !isObject(periods[0])) {
			throw new Error('The charging schedule period is not an array of objects');
		}
		periods[0]['limit'] = 0.35;
		const result = await validator.validatePayload('SetChargingProfile', 'request', invalid);
		expect(result.status).toBe('invalid-payload');
		expect(result.issues.some((issue) => issue.keyword === 'multipleOf')).toBe(true);
	});
});
