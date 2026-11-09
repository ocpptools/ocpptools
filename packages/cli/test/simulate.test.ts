// SPDX-License-Identifier: Apache-2.0
// SPDX-FileCopyrightText: 2026 Rodolfo Carrillo

import { mkdtemp, readdir, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { afterEach, describe, expect, it } from 'vitest';
import { WebSocketServer, type WebSocket as ServerWebSocket } from 'ws';

import {
	applySimulatorConfig,
	createConfiguredSimulator,
	formatSimulationResult,
	parseScenario,
	parseSimulatorConfig,
} from '../src/simulate.js';
import { runCli } from '../src/index.js';

import { captureIo } from './helpers.js';

interface Csms {
	readonly url: string;
	readonly actions: string[];
	close(): Promise<void>;
}

async function startCsms(
	version: '1.6' | '2.0.1',
	options: { readonly bootStatus?: 'Accepted' | 'Rejected' } = {},
): Promise<Csms> {
	const subprotocol = version === '1.6' ? 'ocpp1.6' : 'ocpp2.0.1';
	const actions: string[] = [];
	const sockets = new Set<ServerWebSocket>();
	const server = new WebSocketServer({
		host: '127.0.0.1',
		port: 0,
		handleProtocols: (protocols) => (protocols.has(subprotocol) ? subprotocol : false),
	});
	await new Promise<void>((resolve, reject) => {
		server.once('listening', resolve);
		server.once('error', reject);
	});
	server.on('connection', (socket) => {
		sockets.add(socket);
		socket.on('close', () => {
			sockets.delete(socket);
		});
		socket.on('message', (data) => {
			const text = Array.isArray(data)
				? Buffer.concat(data).toString('utf8')
				: Buffer.from(data as ArrayBuffer).toString('utf8');
			const frame = JSON.parse(text) as unknown[];
			if (frame[0] !== 2) return;
			const [, id, action] = frame as [number, string, string];
			actions.push(action);
			socket.send(JSON.stringify([3, id, responseFor(version, action, options.bootStatus)]));
		});
	});
	const address = server.address();
	if (address === null || typeof address === 'string') {
		throw new Error('The test server did not expose a TCP address');
	}
	return {
		url: `ws://127.0.0.1:${String(address.port)}/CP001`,
		actions,
		close: async () => {
			for (const socket of sockets) socket.terminate();
			await new Promise<void>((resolve, reject) => {
				server.close((error) => (error === undefined ? resolve() : reject(error)));
			});
		},
	};
}

function responseFor(
	version: '1.6' | '2.0.1',
	action: string,
	bootStatus: 'Accepted' | 'Rejected' = 'Accepted',
): unknown {
	const currentTime = new Date().toISOString();
	if (version === '1.6') {
		switch (action) {
			case 'BootNotification':
				return { status: bootStatus, currentTime, interval: 60 };
			case 'Authorize':
				return { idTagInfo: { status: 'Accepted' } };
			case 'StartTransaction':
				return { transactionId: 1, idTagInfo: { status: 'Accepted' } };
			case 'StopTransaction':
				return { idTagInfo: { status: 'Accepted' } };
			default:
				return {};
		}
	}
	switch (action) {
		case 'BootNotification':
			return { status: bootStatus, currentTime, interval: 60 };
		case 'Authorize':
			return {
				idTokenInfo: { status: 'Accepted', cacheExpiryDateTime: currentTime },
			};
		default:
			return {};
	}
}

const directories: string[] = [];

async function configFile(value: unknown): Promise<string> {
	const directory = await mkdtemp(join(tmpdir(), 'ocpptools-cli-simulate-'));
	directories.push(directory);
	const path = join(directory, 'config.json');
	await writeFile(path, JSON.stringify(value), 'utf8');
	return path;
}

async function scenarioFile(value: unknown): Promise<string> {
	const directory = await mkdtemp(join(tmpdir(), 'ocpptools-cli-scenario-'));
	directories.push(directory);
	const path = join(directory, 'scenario.json');
	await writeFile(path, JSON.stringify(value), 'utf8');
	return path;
}

const STEPS = [
	{ type: 'boot' },
	{ type: 'authorize', idToken: 'TAG' },
	{ type: 'start', idToken: 'TAG' },
	{ type: 'meter' },
	{ type: 'stop' },
];

async function waitFor(predicate: () => boolean, label: string, timeoutMs = 2000): Promise<void> {
	const deadline = Date.now() + timeoutMs;
	while (!predicate()) {
		if (Date.now() > deadline) throw new Error(`Timed out waiting for ${label}`);
		await new Promise((resolve) => setTimeout(resolve, 10));
	}
}

afterEach(async () => {
	await Promise.all(
		directories.splice(0).map((directory) => rm(directory, { recursive: true, force: true })),
	);
});

describe('simulate command', () => {
	it.each(['1.6', '2.0.1'] as const)(
		'runs a scenario against a local CSMS for OCPP %s',
		async (version) => {
			const csms = await startCsms(version);
			try {
				const config = await configFile({
					version,
					url: csms.url,
					station:
						version === '1.6'
							? {
									id: 'CP001',
									vendor: 'Acme',
									model: 'AC-7',
									firmwareVersion: '1.0.0',
								}
							: {
									id: 'CP001',
									vendorName: 'Acme',
									model: 'AC-22',
									firmwareVersion: '2.0.0',
								},
				});
				const scenario = await scenarioFile(STEPS);
				const captured = captureIo();
				await expect(
					runCli(['simulate', '--config', config, '--scenario', scenario], captured.io),
				).resolves.toBe(0);
				expect(captured.stdout()).toContain('Simulation completed');
				expect(captured.stderr()).toBe('');
				await waitFor(
					() =>
						csms.actions.includes('MeterValues') &&
						csms.actions.includes(version === '1.6' ? 'StopTransaction' : 'TransactionEvent'),
					'the CSMS to receive the scenario frames',
				);
				expect(csms.actions).toContain('BootNotification');
				expect(csms.actions).toContain('Authorize');
				expect(csms.actions).toContain('MeterValues');
				if (version === '1.6') {
					expect(csms.actions).toContain('StartTransaction');
					expect(csms.actions).toContain('StopTransaction');
				} else {
					expect(csms.actions).toContain('TransactionEvent');
				}
			} finally {
				await csms.close();
			}
		},
		20_000,
	);

	it('supports the scenario run alias and JSON output', async () => {
		const csms = await startCsms('1.6');
		try {
			const config = await configFile({
				version: '1.6',
				url: csms.url,
				station: { id: 'CP001', vendor: 'Acme', model: 'AC-7', firmwareVersion: '1.0.0' },
			});
			const scenario = await scenarioFile(STEPS);
			const captured = captureIo();
			await expect(
				runCli(['scenario', 'run', scenario, '--config', config, '--json'], captured.io),
			).resolves.toBe(0);
			const result = JSON.parse(captured.stdout()) as {
				status?: string;
				steps?: unknown[];
			};
			expect(result.status).toBe('completed');
			expect(result.steps).toHaveLength(STEPS.length);
		} finally {
			await csms.close();
		}
	}, 20_000);

	it('reports a failed scenario with exit code 3', async () => {
		const csms = await startCsms('1.6', { bootStatus: 'Rejected' });
		try {
			const config = await configFile({
				version: '1.6',
				url: csms.url,
				station: { id: 'CP001', vendor: 'Acme', model: 'AC-7', firmwareVersion: '1.0.0' },
			});
			const scenario = await scenarioFile([{ type: 'boot' }]);
			const captured = captureIo();
			await expect(
				runCli(['simulate', '--config', config, '--scenario', scenario], captured.io),
			).resolves.toBe(3);
			expect(captured.stdout()).toContain('Simulation failed');
			expect(captured.stdout()).toContain('scenario-failed');
		} finally {
			await csms.close();
		}
	}, 20_000);

	it('waits for auto-boot before starting the scenario', async () => {
		const csms = await startCsms('1.6');
		try {
			const config = await configFile({
				version: '1.6',
				url: csms.url,
				station: { id: 'CP001', vendor: 'Acme', model: 'AC-7', firmwareVersion: '1.0.0' },
				boot: { auto: true, required: true },
			});
			const scenario = await scenarioFile([{ type: 'heartbeat' }]);
			const captured = captureIo();
			await expect(
				runCli(['simulate', '--config', config, '--scenario', scenario], captured.io),
			).resolves.toBe(0);
			expect(csms.actions).toContain('BootNotification');
			expect(csms.actions).toContain('Heartbeat');
		} finally {
			await csms.close();
		}
	}, 20_000);

	it('prints validation warnings without blocking the frame', async () => {
		const csms = await startCsms('1.6');
		try {
			const config = await configFile({
				version: '1.6',
				url: csms.url,
				station: { id: 'CP001', vendor: 'Acme', model: 'AC-7', firmwareVersion: '1.0.0' },
				validation: { mode: 'warn' },
			});
			const scenario = await scenarioFile([
				{ type: 'boot' },
				{ type: 'call', action: 'DataTransfer', payload: { vendorId: 123 } },
			]);
			const captured = captureIo();
			await expect(
				runCli(['simulate', '--config', config, '--scenario', scenario], captured.io),
			).resolves.toBe(0);
			expect(captured.stderr()).toContain('validation warning');
			expect(csms.actions).toContain('DataTransfer');
		} finally {
			await csms.close();
		}
	}, 20_000);

	it('blocks invalid outbound frames when validation.mode is block', async () => {
		const csms = await startCsms('1.6');
		try {
			const config = await configFile({
				version: '1.6',
				url: csms.url,
				station: { id: 'CP001', vendor: 'Acme', model: 'AC-7', firmwareVersion: '1.0.0' },
				validation: { mode: 'block' },
			});
			const scenario = await scenarioFile([
				{ type: 'boot' },
				{ type: 'call', action: 'DataTransfer', payload: { vendorId: 123 } },
			]);
			const captured = captureIo();
			await expect(
				runCli(['simulate', '--config', config, '--scenario', scenario], captured.io),
			).resolves.toBe(3);
			expect(captured.stderr()).toContain('blocked: DataTransfer');
			expect(csms.actions).not.toContain('DataTransfer');
		} finally {
			await csms.close();
		}
	}, 20_000);

	it('loads and saves state with a file storage directory', async () => {
		const csms = await startCsms('1.6');
		const directory = await mkdtemp(join(tmpdir(), 'ocpptools-cli-storage-'));
		directories.push(directory);
		try {
			const config = await configFile({
				version: '1.6',
				url: csms.url,
				station: { id: 'CP001', vendor: 'Acme', model: 'AC-7', firmwareVersion: '1.0.0' },
				storage: { directory, key: 'CP001' },
			});
			const scenario = await scenarioFile([{ type: 'boot' }, { type: 'heartbeat' }]);
			const first = captureIo();
			await expect(
				runCli(['simulate', '--config', config, '--scenario', scenario], first.io),
			).resolves.toBe(0);
			expect((await readdir(directory)).length).toBeGreaterThan(0);
			const second = captureIo();
			await expect(
				runCli(['simulate', '--config', config, '--scenario', scenario], second.io),
			).resolves.toBe(0);
			expect(second.stderr()).toBe('');
		} finally {
			await csms.close();
		}
	}, 20_000);

	it('reports config and scenario errors with exit code 2', async () => {
		const scenario = await scenarioFile(STEPS);
		const badVersion = await configFile({
			version: '2.1',
			url: 'ws://127.0.0.1:1/CP001',
			station: {},
		});
		const missingVendor = await configFile({
			version: '1.6',
			url: 'ws://127.0.0.1:1/CP001',
			station: { id: 'CP001', model: 'AC-7', firmwareVersion: '1.0.0' },
		});
		const validConfig = await configFile({
			version: '1.6',
			url: 'ws://127.0.0.1:1/CP001',
			station: { id: 'CP001', vendor: 'Acme', model: 'AC-7', firmwareVersion: '1.0.0' },
		});
		const badScenario = await scenarioFile([{ type: 'wait', ms: -1 }]);

		for (const args of [
			['simulate', '--config', badVersion, '--scenario', scenario],
			['simulate', '--config', missingVendor, '--scenario', scenario],
			['simulate', '--config', validConfig, '--scenario', badScenario],
		]) {
			const captured = captureIo();
			await expect(runCli(args, captured.io), args.join(' ')).resolves.toBe(2);
			expect(captured.stderr()).not.toBe('');
		}
	});

	it('reports a connection failure with exit code 3', async () => {
		const config = await configFile({
			version: '1.6',
			url: 'ws://127.0.0.1:1/CP001',
			station: { id: 'CP001', vendor: 'Acme', model: 'AC-7', firmwareVersion: '1.0.0' },
			reconnect: { enabled: false },
		});
		const scenario = await scenarioFile([{ type: 'boot' }]);
		const captured = captureIo();
		await expect(
			runCli(['simulate', '--config', config, '--scenario', scenario], captured.io),
		).resolves.toBe(3);
		expect(captured.stderr()).toContain('simulation failed');
		expect(captured.stderr()).toContain('Could not connect');
	}, 20_000);
});

describe('simulator config and scenario checks', () => {
	it('accepts a full config and normalizes its optional fields', () => {
		const config = parseSimulatorConfig({
			version: '2.0.1',
			url: 'ws://127.0.0.1:9000/CP001',
			station: {
				id: 'CP001',
				vendorName: 'Acme',
				model: 'AC-22',
				firmwareVersion: '2.0.0',
				evseCount: 2,
				defaultIdToken: 'TAG',
				idTokenType: 'ISO14443',
				defaultChargingPowerKw: 7.4,
			},
			boot: { auto: true, required: false, retryOnPending: true, retryIntervalMs: 1000 },
			timing: {
				pendingCallTimeoutMs: 1000,
				heartbeatIntervalMs: 1000,
				meterValueIntervalMs: 1000,
			},
			reconnect: {
				enabled: true,
				maxAttempts: 2,
				baseDelayMs: 10,
				maxDelayMs: 20,
				jitter: true,
			},
			faults: { latencyMs: 1, dropRate: 0.5, malformRate: 0.5 },
			validation: { mode: 'block' },
			inbound: { policy: 'reject' },
			history: { maxEntries: 10 },
			storage: {
				directory: '.cache/cli-test',
				key: 'cp',
				autoSave: false,
				saveDebounceMs: 0,
				includeHistory: true,
			},
		});
		expect(config.version).toBe('2.0.1');
		if (config.version !== '2.0.1') throw new Error('unreachable');
		expect(config.station.evseCount).toBe(2);
		const simulator = createConfiguredSimulator(config);
		expect(simulator.version).toBe('2.0.1');
		simulator.dispose();
	});

	it('reapplies full fault defaults instead of inheriting snapshot values', () => {
		const config = parseSimulatorConfig({
			version: '1.6',
			url: 'ws://127.0.0.1:9000/CP001',
			station: { id: 'CP001', vendor: 'Acme', model: 'AC-7', firmwareVersion: '1.0.0' },
			faults: { latencyMs: 100 },
		});
		const simulator = createConfiguredSimulator(config);
		applySimulatorConfig(simulator, config);
		expect(simulator.getFaults()).toEqual({ latencyMs: 100, dropRate: 0, malformRate: 0 });
		simulator.dispose();
	});

	it('accepts the OCPP 1.6 station shape', () => {
		const config = parseSimulatorConfig({
			version: '1.6',
			url: 'ws://127.0.0.1:9000/CP001',
			station: {
				id: 'CP001',
				vendor: 'Acme',
				model: 'AC-7',
				firmwareVersion: '1.0.0',
				connectorCount: 2,
				defaultIdTag: 'TAG',
				defaultChargingPowerKw: 7.4,
			},
		});
		expect(config.version).toBe('1.6');
		const simulator = createConfiguredSimulator(config);
		expect(simulator.version).toBe('1.6');
		simulator.dispose();
	});

	it('rejects wrong shapes and out-of-range options', () => {
		const base = {
			version: '1.6',
			url: 'ws://127.0.0.1:9000/CP001',
			station: { id: 'CP001', vendor: 'Acme', model: 'AC-7', firmwareVersion: '1.0.0' },
		};
		const cases: unknown[] = [
			null,
			{ ...base, version: '2.1' },
			{ ...base, url: '' },
			{ ...base, url: 'not a url' },
			{ ...base, url: 'https://example.com/ocpp' },
			{ ...base, station: [] },
			{ ...base, station: { ...base.station, vendor: '' } },
			{
				...base,
				version: '2.0.1',
				station: { id: 'CP001', model: 'AC-22', firmwareVersion: '2.0.0' },
			},
			{
				...base,
				version: '2.0.1',
				station: {
					id: 'CP001',
					vendorName: 'Acme',
					model: 'AC-22',
					firmwareVersion: '2.0.0',
					idTokenType: 'Bogus',
				},
			},
			{ ...base, boot: { auto: 'yes' } },
			{ ...base, boot: { retryIntervalMs: 0 } },
			{ ...base, timing: { heartbeatIntervalMs: 0 } },
			{ ...base, timing: { meterValueIntervalMs: -1 } },
			{ ...base, reconnect: { maxAttempts: 0 } },
			{ ...base, reconnect: { maxAttempts: 1.5 } },
			{ ...base, reconnect: { baseDelayMs: 0 } },
			{ ...base, reconnect: { baseDelayMs: 20, maxDelayMs: 10 } },
			{ ...base, reconnect: { jitter: 'yes' } },
			{ ...base, faults: { latencyMs: 60_001 } },
			{ ...base, faults: { dropRate: 2 } },
			{ ...base, faults: { malformRate: -1 } },
			{ ...base, validation: { mode: 'strict' } },
			{ ...base, inbound: { policy: 'maybe' } },
			{ ...base, history: { maxEntries: 0 } },
			{ ...base, storage: { directory: '' } },
			{ ...base, storage: { key: '' } },
			{ ...base, storage: { autoSave: 'yes' } },
			{ ...base, storage: { saveDebounceMs: -1 } },
			{ ...base, storage: { includeHistory: 'yes' } },
		];
		for (const value of cases) {
			expect(() => parseSimulatorConfig(value), JSON.stringify(value)).toThrow();
		}
	});

	it('rejects malformed scenarios', () => {
		const cases: unknown[] = [
			{},
			[null],
			[{ type: 1 }],
			[{ type: 'unknown' }],
			[{ type: 'wait' }],
			[{ type: 'wait', ms: -1 }],
			[{ type: 'call', action: '', payload: {} }],
			[{ type: 'call', action: 'DataTransfer' }],
			[{ type: 'start', entityId: 'one' }],
			[{ type: 'start', idToken: 1 }],
		];
		for (const value of cases) {
			expect(() => parseScenario(value), JSON.stringify(value)).toThrow();
		}
	});

	it('formats a failed result with its step and error', () => {
		const text = formatSimulationResult({
			status: 'failed',
			startedAt: 10,
			finishedAt: 20,
			steps: [
				{
					index: 0,
					type: 'boot',
					status: 'failed',
					error: { name: 'SimulatorError', code: 'scenario-failed', message: 'nope' },
				},
			],
			error: { name: 'SimulatorError', code: 'scenario-failed', message: 'nope' },
		});
		expect(text).toContain('Simulation failed');
		expect(text).toContain('boot failed');
		expect(text).toContain('scenario-failed: nope');
	});
});
