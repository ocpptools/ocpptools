// SPDX-License-Identifier: Apache-2.0
// SPDX-FileCopyrightText: 2026 Rodolfo Carrillo

import { readdirSync, readFileSync } from 'node:fs';
import { extname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

import { describe, expect, it } from 'vitest';

import {
	DEVICE_MODEL_CATALOG_201,
	createDeviceModelVariables201,
} from '../src/profiles/2.0.1/device-model.js';
import { createHarness201, framePayload, type Harness201 } from './helpers/simulator-201.js';

async function call(
	harness: Harness201,
	messageId: string,
	action: string,
	payload: unknown,
): Promise<Record<string, unknown>> {
	harness.incoming(messageId, action, payload);
	await harness.ready();
	return framePayload(harness.reply(messageId));
}

function sourceFiles(directory: string): string[] {
	const files: string[] = [];
	for (const entry of readdirSync(directory, { withFileTypes: true })) {
		const path = join(directory, entry.name);
		if (entry.isDirectory()) files.push(...sourceFiles(path));
		else files.push(path);
	}
	return files;
}

describe('Simulator201 curated device model', () => {
	it('keeps the catalog small and immutable', () => {
		expect(Object.isFrozen(DEVICE_MODEL_CATALOG_201)).toBe(true);
		expect(DEVICE_MODEL_CATALOG_201).toEqual({
			'OCPPCommCtrlr/HeartbeatInterval': '60',
			'AlignedDataCtrlr/Enabled': 'true',
			'SampledDataCtrlr/TxUpdatedInterval': '30',
			'DeviceDataCtrlr/Enabled': 'true',
		});
		expect(createDeviceModelVariables201()).toEqual(DEVICE_MODEL_CATALOG_201);
		expect(createDeviceModelVariables201()).not.toBe(DEVICE_MODEL_CATALOG_201);
	});

	it('exposes only catalog variables through GetVariables and the API', async () => {
		const harness = createHarness201();
		await harness.ready();
		harness.simulator.state.variables['OCPPCommCtrlr/Custom'] = '1';
		harness.simulator.state.variables['Custom/Variable'] = '2';

		const result = await call(harness, 'catalog-get', 'GetVariables', {
			getVariableData: [
				{
					component: { name: 'OCPPCommCtrlr' },
					variable: { name: 'HeartbeatInterval' },
				},
				{
					component: { name: 'OCPPCommCtrlr' },
					variable: { name: 'Custom' },
				},
				{
					component: { name: 'Custom' },
					variable: { name: 'Variable' },
				},
			],
		});
		const statuses = (result['getVariableResult'] as Array<Record<string, unknown>>).map(
			(entry) => entry['attributeStatus'],
		);
		expect(statuses).toEqual(['Accepted', 'UnknownVariable', 'UnknownComponent']);
		expect(harness.simulator.deviceModel.variables()).toEqual(DEVICE_MODEL_CATALOG_201);
	});

	it('rejects SetVariables outside the catalog', async () => {
		const harness = createHarness201();
		await harness.ready();
		const result = await call(harness, 'catalog-set', 'SetVariables', {
			setVariableData: [
				{
					component: { name: 'OCPPCommCtrlr' },
					variable: { name: 'Custom' },
					attributeValue: '1',
				},
				{
					component: { name: 'Custom' },
					variable: { name: 'Variable' },
					attributeValue: '2',
				},
			],
		});
		expect(result).toMatchObject({
			setVariableResult: [
				{ attributeStatus: 'UnknownVariable' },
				{ attributeStatus: 'UnknownComponent' },
			],
		});
		expect(harness.simulator.state.variables['OCPPCommCtrlr/Custom']).toBeUndefined();
		expect(harness.simulator.state.variables['Custom/Variable']).toBeUndefined();
	});

	it('filters extra state variables from inventory and monitoring reports', async () => {
		const harness = createHarness201();
		await harness.ready();
		harness.simulator.state.variables['OCPPCommCtrlr/Custom'] = '1';
		harness.simulator.state.monitoring.monitors.push({
			id: 99,
			component: { name: 'OCPPCommCtrlr' },
			variable: { name: 'Custom' },
			value: 1,
			type: 'Periodic',
			severity: 1,
			transaction: false,
			triggered: false,
			lastReportedValue: null,
		});

		expect(
			await call(harness, 'catalog-base-report', 'GetBaseReport', {
				requestId: 7,
				reportBase: 'FullInventory',
			}),
		).toEqual({ status: 'Accepted' });
		const report = harness
			.calls('NotifyReport')
			.map((frame) => frame[3] as Record<string, unknown>)
			.at(-1);
		const reportData = report?.['reportData'] as Array<Record<string, unknown>>;
		expect(reportData).toHaveLength(4);
		expect(
			reportData.map(
				(entry) =>
					`${String((entry['component'] as JsonName).name)}/${String((entry['variable'] as JsonName).name)}`,
			),
		).toEqual(Object.keys(DEVICE_MODEL_CATALOG_201));

		expect(
			await call(harness, 'catalog-monitor-report', 'GetMonitoringReport', {
				requestId: 8,
			}),
		).toEqual({ status: 'EmptyResultSet' });
		expect(harness.calls('NotifyMonitoringReport')).toHaveLength(0);
		expect(harness.simulator.monitoring.list()).toEqual([]);
	});

	it('filters extra state variables from the public report APIs', async () => {
		const harness = createHarness201();
		await harness.ready();
		harness.simulator.state.variables['Vendor/Custom'] = '5';
		harness.simulator.state.monitoring.monitors.push({
			id: 100,
			component: { name: 'Vendor' },
			variable: { name: 'Custom' },
			value: 1,
			type: 'Periodic',
			severity: 1,
			transaction: false,
			triggered: false,
			lastReportedValue: null,
		});

		await harness.simulator.deviceModel.sendReport({ requestId: 9 });
		const report = harness
			.calls('NotifyReport')
			.map((frame) => frame[3] as Record<string, unknown>)
			.at(-1);
		expect(report?.['reportData']).toHaveLength(4);
		expect(JSON.stringify(report)).not.toContain('Vendor');

		await harness.simulator.deviceModel.sendMonitoringReport({ requestId: 10 });
		const monitoring = harness
			.calls('NotifyMonitoringReport')
			.map((frame) => frame[3] as Record<string, unknown>)
			.at(-1);
		expect(monitoring).not.toHaveProperty('monitor');
	});

	it('seeds catalog defaults when a snapshot omits them', async () => {
		const first = createHarness201();
		await first.ready();
		first.simulator.state.variables = { 'Vendor/Custom': '5' };
		const snapshot = first.simulator.exportSnapshot();

		const second = createHarness201();
		await second.ready();
		expect(second.simulator.restoreSnapshot(snapshot)).toEqual({ restored: true });
		expect(second.simulator.state.variables).toMatchObject(DEVICE_MODEL_CATALOG_201);
		expect(second.simulator.state.variables['Vendor/Custom']).toBe('5');
		first.simulator.dispose();
		second.simulator.dispose();
	});

	it('does not emit events for restored monitors outside the catalog', async () => {
		const first = createHarness201();
		await first.ready();
		first.simulator.state.variables['Vendor/Custom'] = '5';
		first.simulator.state.monitoring.monitors.push({
			id: 77,
			component: { name: 'Vendor' },
			variable: { name: 'Custom' },
			value: 1,
			type: 'Periodic',
			severity: 1,
			transaction: false,
			triggered: false,
			lastReportedValue: null,
		});
		const snapshot = first.simulator.exportSnapshot();

		const second = createHarness201();
		await second.ready();
		expect(second.simulator.restoreSnapshot(snapshot)).toEqual({ restored: true });
		second.clock.advance(1000);
		await second.ready();
		expect(
			second.calls('NotifyEvent').filter((frame) => JSON.stringify(frame[3]).includes('Vendor')),
		).toHaveLength(0);
		first.simulator.dispose();
		second.simulator.dispose();
	});

	it('does not import OCA schemas or ship generated catalogs in the package', () => {
		const sourceDirectory = fileURLToPath(new URL('../src/', import.meta.url));
		const files = sourceFiles(sourceDirectory);
		expect(files.filter((file) => extname(file) === '.json')).toEqual([]);
		for (const file of files.filter((entry) => extname(entry) === '.ts')) {
			const text = readFileSync(file, 'utf8');
			expect(text, file).not.toMatch(
				/(?:\bfrom\s+|\bimport\s*\(\s*|\brequire\s*\(\s*|\bimport\s+)['"]@ocpptools\/schemas(?:\/[^'"]*)?['"]/,
			);
			expect(text, file).not.toMatch(/['"][^'"]*schemas\/schemas[^'"]*['"]/);
		}
		const manifest = JSON.parse(
			readFileSync(fileURLToPath(new URL('../package.json', import.meta.url)), 'utf8'),
		) as {
			dependencies?: Record<string, string>;
			peerDependencies?: Record<string, string>;
			optionalDependencies?: Record<string, string>;
			files?: string[];
		};
		for (const section of [
			manifest.dependencies,
			manifest.peerDependencies,
			manifest.optionalDependencies,
		]) {
			expect(section?.['@ocpptools/schemas']).toBeUndefined();
		}
		expect(manifest.files?.some((entry) => entry.includes('schemas'))).not.toBe(true);
	});
});

interface JsonName {
	readonly name: string;
}
