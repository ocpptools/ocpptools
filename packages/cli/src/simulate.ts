// SPDX-License-Identifier: Apache-2.0
// SPDX-FileCopyrightText: 2026 Rodolfo Carrillo

import type { CallFrame } from '@ocpptools/core';
import type {
	BootOptions,
	FaultConfig,
	InboundResponseMode,
	ReconnectOptions,
	ScenarioResult,
	ScenarioRun,
	ScenarioStep,
	TimingOptions,
	ValidateMode,
} from '@ocpptools/simulator';
import {
	createNodeWebSocketTransportFactory,
	createFileStorage,
	createMemoryStorage,
	nodeClock,
} from '@ocpptools/simulator/node';
import type { Station16Options } from '@ocpptools/simulator/1.6';
import { Simulator16 } from '@ocpptools/simulator/1.6';
import type { Station201Options } from '@ocpptools/simulator/2.0.1';
import { Simulator201 } from '@ocpptools/simulator/2.0.1';

import { createCliValidator } from './schemas.js';
import { terminalSafe } from './text.js';
import { readInput } from './validate.js';

const DEFAULT_BOOT: BootOptions = {
	auto: false,
	required: true,
	retryOnPending: false,
};
const DEFAULT_CONNECTION_TIMEOUT_MS = 15_000;

/** Where the CLI stores simulator state between runs. */
export interface CliStorageOptions {
	/** A directory for one file per key. Omit it to keep state in memory. */
	readonly directory?: string;
	/** The persistence key. Defaults to the station ID. */
	readonly key?: string;
	readonly autoSave?: boolean;
	readonly saveDebounceMs?: number;
	readonly includeHistory?: boolean;
}

export interface CommonCliConfig {
	readonly url: string;
	readonly boot?: BootOptions;
	readonly timing?: TimingOptions;
	readonly reconnect?: ReconnectOptions;
	readonly faults?: Partial<FaultConfig>;
	readonly validation?: { readonly mode?: ValidateMode };
	readonly inbound?: { readonly policy?: InboundResponseMode };
	readonly history?: { readonly maxEntries?: number };
	readonly storage?: CliStorageOptions;
}

export type SimulatorCliConfig =
	| (CommonCliConfig & { readonly version: '1.6'; readonly station: Station16Options })
	| (CommonCliConfig & { readonly version: '2.0.1'; readonly station: Station201Options });

export type CliSimulator = Simulator16 | Simulator201;

export interface SimulationOptions {
	/** Called once the transport is open and the scenario starts. */
	readonly onStart?: (run: ScenarioRun, simulator: CliSimulator) => void;
	/** Called when persisted state cannot be loaded. */
	readonly onLoadError?: (message: string) => void;
	/** Called when the final state cannot be saved. */
	readonly onSaveError?: (message: string) => void;
	/** Load and save simulator state. Defaults to false. */
	readonly persist?: boolean;
	/** Wait for boot acceptance after opening, for auto-boot configs. */
	readonly requireReady?: boolean;
	/** Reapplies CLI config after loading a snapshot. */
	readonly applyConfig?: (simulator: CliSimulator) => void;
	/** How long to wait for the WebSocket to open. Defaults to 15 seconds. */
	readonly connectionTimeoutMs?: number;
}

const ID_TOKEN_KINDS_201 = new Set([
	'Central',
	'eMAID',
	'ISO14443',
	'ISO15693',
	'KeyCode',
	'Local',
	'MacAddress',
	'NoAuthorization',
]);

/** Reads and validates a simulator config file. */
export async function loadSimulatorConfig(
	file: string,
	stdin?: () => Promise<string>,
): Promise<SimulatorCliConfig> {
	const text = await readInput(file, stdin);
	let value: unknown;
	try {
		value = JSON.parse(text) as unknown;
	} catch (error) {
		throw new Error(`The file ${file} is not valid JSON: ${errorMessage(error)}`, {
			cause: error,
		});
	}
	return parseSimulatorConfig(value);
}

/** Reads and validates a scenario file. */
export async function loadScenarioFile(
	file: string,
	stdin?: () => Promise<string>,
): Promise<readonly ScenarioStep[]> {
	const text = await readInput(file, stdin);
	let value: unknown;
	try {
		value = JSON.parse(text) as unknown;
	} catch (error) {
		throw new Error(`The file ${file} is not valid JSON: ${errorMessage(error)}`, {
			cause: error,
		});
	}
	return parseScenario(value);
}

/** Checks the fields of an already parsed simulator config. */
export function parseSimulatorConfig(value: unknown): SimulatorCliConfig {
	const record = requireRecord(value, 'config');
	const rawVersion = record['version'];
	if (rawVersion !== '1.6' && rawVersion !== '2.0.1') {
		throw new Error('config.version must be "1.6" or "2.0.1"');
	}
	const version = rawVersion;
	const url = requireUrl(record['url'], 'config.url');
	const stationRecord = requireRecord(record['station'], 'config.station');
	const boot = optionalRecord(record, 'boot', parseBoot);
	const timing = optionalRecord(record, 'timing', parseTiming);
	const reconnect = optionalRecord(record, 'reconnect', parseReconnect);
	const faults = optionalRecord(record, 'faults', parseFaults);
	const validation = optionalRecord(record, 'validation', parseValidation);
	const inbound = optionalRecord(record, 'inbound', parseInbound);
	const history = optionalRecord(record, 'history', parseHistory);
	const storage = optionalRecord(record, 'storage', parseStorage);
	const common: CommonCliConfig = {
		url,
		...(boot === undefined ? {} : { boot }),
		...(timing === undefined ? {} : { timing }),
		...(reconnect === undefined ? {} : { reconnect }),
		...(faults === undefined ? {} : { faults }),
		...(validation === undefined ? {} : { validation }),
		...(inbound === undefined ? {} : { inbound }),
		...(history === undefined ? {} : { history }),
		...(storage === undefined ? {} : { storage }),
	};

	if (version === '1.6') {
		const connectorCount = optionalInteger(
			stationRecord,
			'connectorCount',
			'config.station.connectorCount',
			1,
		);
		const defaultIdTag = optionalString(
			stationRecord,
			'defaultIdTag',
			'config.station.defaultIdTag',
		);
		const defaultChargingPowerKw = optionalNumber(
			stationRecord,
			'defaultChargingPowerKw',
			'config.station.defaultChargingPowerKw',
			0,
		);
		return {
			...common,
			version,
			station: {
				id: requireString(stationRecord, 'id', 'config.station.id'),
				vendor: requireString(stationRecord, 'vendor', 'config.station.vendor'),
				model: requireString(stationRecord, 'model', 'config.station.model'),
				firmwareVersion: requireString(
					stationRecord,
					'firmwareVersion',
					'config.station.firmwareVersion',
				),
				...(connectorCount === undefined ? {} : { connectorCount }),
				...(defaultIdTag === undefined ? {} : { defaultIdTag }),
				...(defaultChargingPowerKw === undefined ? {} : { defaultChargingPowerKw }),
			},
		};
	}

	const evseCount = optionalInteger(stationRecord, 'evseCount', 'config.station.evseCount', 1);
	const defaultIdToken = optionalString(
		stationRecord,
		'defaultIdToken',
		'config.station.defaultIdToken',
	);
	const idTokenTypeValue = optionalString(
		stationRecord,
		'idTokenType',
		'config.station.idTokenType',
	);
	if (idTokenTypeValue !== undefined && !ID_TOKEN_KINDS_201.has(idTokenTypeValue)) {
		throw new Error(
			`config.station.idTokenType is not a valid 2.0.1 idToken type: ${idTokenTypeValue}`,
		);
	}
	const idTokenType = idTokenTypeValue as Station201Options['idTokenType'] | undefined;
	const defaultChargingPowerKw = optionalNumber(
		stationRecord,
		'defaultChargingPowerKw',
		'config.station.defaultChargingPowerKw',
		0,
	);
	return {
		...common,
		version,
		station: {
			id: requireString(stationRecord, 'id', 'config.station.id'),
			vendorName: requireString(stationRecord, 'vendorName', 'config.station.vendorName'),
			model: requireString(stationRecord, 'model', 'config.station.model'),
			firmwareVersion: requireString(
				stationRecord,
				'firmwareVersion',
				'config.station.firmwareVersion',
			),
			...(evseCount === undefined ? {} : { evseCount }),
			...(defaultIdToken === undefined ? {} : { defaultIdToken }),
			...(idTokenType === undefined ? {} : { idTokenType }),
			...(defaultChargingPowerKw === undefined ? {} : { defaultChargingPowerKw }),
		},
	};
}

/** Checks the shape of an already parsed scenario. */
export function parseScenario(value: unknown): readonly ScenarioStep[] {
	if (!Array.isArray(value)) {
		throw new Error('The scenario must be a JSON array of steps');
	}
	const steps: ScenarioStep[] = [];
	for (const [index, entry] of value.entries()) {
		const step = requireRecord(entry, `scenario[${String(index)}]`);
		const type = step['type'];
		if (typeof type !== 'string') {
			throw new Error(`scenario[${String(index)}].type must be a string`);
		}
		validateEntityFields(step, index);
		if (type === 'wait') {
			const ms = step['ms'];
			if (typeof ms !== 'number' || !Number.isFinite(ms) || ms < 0) {
				throw new Error(`scenario[${String(index)}].ms must be a non-negative number`);
			}
		}
		if (type === 'call') {
			const action = step['action'];
			if (typeof action !== 'string' || action === '') {
				throw new Error(`scenario[${String(index)}].action must be a non-empty string`);
			}
			requireRecord(step['payload'], `scenario[${String(index)}].payload`);
		}
		if (!SCENARIO_STEP_TYPES.has(type)) {
			throw new Error(`scenario[${String(index)}].type is not a scenario step: ${type}`);
		}
		steps.push(step as unknown as ScenarioStep);
	}
	return steps;
}

const SCENARIO_STEP_TYPES = new Set([
	'boot',
	'heartbeat',
	'status',
	'authorize',
	'start',
	'wait',
	'meter',
	'stop',
	'call',
]);

/**
 * Builds a simulator for a checked config. Transport, clock, and optional
 * persistence use the Node adapter.
 */
export function createConfiguredSimulator(config: SimulatorCliConfig): CliSimulator {
	const persistence = createPersistence(config);
	const validator = createCliValidator(config.version);
	const common = {
		url: config.url,
		transport: createNodeWebSocketTransportFactory(),
		clock: nodeClock,
		boot: { ...DEFAULT_BOOT, ...config.boot },
		...(config.timing === undefined ? {} : { timing: config.timing }),
		...(config.reconnect === undefined ? {} : { reconnect: config.reconnect }),
		...(config.faults === undefined ? {} : { faults: config.faults }),
		validation: {
			mode: config.validation?.mode ?? 'off',
			validateOutbound: async (frame: CallFrame) => {
				const result = await validator.validateFrame(frame);
				return result.valid
					? null
					: result.issues.map((issue) => `${issue.pointer}: ${issue.message}`);
			},
		},
		...(config.inbound === undefined ? {} : { inbound: config.inbound }),
		...(config.history === undefined ? {} : { history: config.history }),
		...(persistence === undefined ? {} : { persistence }),
	};
	if (config.version === '1.6') {
		return new Simulator16({ ...common, station: config.station });
	}
	return new Simulator201({ ...common, station: config.station });
}

/** Reapplies the CLI-owned runtime settings after a snapshot restore. */
export function applySimulatorConfig(simulator: CliSimulator, config: SimulatorCliConfig): void {
	simulator.setValidationMode(config.validation?.mode ?? 'off');
	simulator.setFaults({
		latencyMs: config.faults?.latencyMs ?? 0,
		dropRate: config.faults?.dropRate ?? 0,
		malformRate: config.faults?.malformRate ?? 0,
	});
	simulator.setInboundResponseMode(config.inbound?.policy ?? 'auto');
	simulator.setHeartbeatIntervalMs(config.timing?.heartbeatIntervalMs ?? 60_000);
	simulator.setMeterValueIntervalMs(config.timing?.meterValueIntervalMs ?? 30_000);
}

/**
 * Connects, runs the steps with `stopOnCancel`, and disconnects. The caller
 * owns the simulator and must dispose it.
 */
export async function runSimulation(
	simulator: CliSimulator,
	steps: readonly ScenarioStep[],
	options: SimulationOptions = {},
): Promise<ScenarioResult> {
	try {
		if (options.persist === true) {
			const loaded = await simulator.load();
			if (loaded.error !== undefined) {
				options.onLoadError?.(loaded.error.message);
			}
		}
		options.applyConfig?.(simulator);
		await waitForConnection(
			simulator,
			options.connectionTimeoutMs ?? DEFAULT_CONNECTION_TIMEOUT_MS,
			options.requireReady === true,
		);
		const run = simulator.runScenario(steps, { stopOnCancel: true });
		options.onStart?.(run, simulator);
		return await run.done;
	} finally {
		if (options.persist === true) {
			const saved = await simulator.save();
			if (!saved.saved && saved.error !== undefined) {
				options.onSaveError?.(saved.error.message);
			}
		}
		simulator.disconnect();
	}
}

/** Formats a scenario result for a terminal. */
export function formatSimulationResult(result: ScenarioResult): string {
	const durationMs = Math.max(0, result.finishedAt - result.startedAt);
	const lines = [
		`Simulation ${result.status}: ${String(result.steps.length)} step(s) in ${String(durationMs)} ms`,
	];
	for (const step of result.steps) {
		const detail =
			step.error === undefined
				? ''
				: ` (${terminalSafe(step.error.code)}: ${terminalSafe(step.error.message)})`;
		lines.push(
			`  [${String(step.index)}] ${terminalSafe(step.type)} ${terminalSafe(step.status)}${detail}`,
		);
	}
	if (result.error !== undefined) {
		lines.push(`Error: ${terminalSafe(result.error.code)}: ${terminalSafe(result.error.message)}`);
	}
	return `${lines.join('\n')}\n`;
}

function createPersistence(config: SimulatorCliConfig):
	| {
			readonly storage: ReturnType<typeof createMemoryStorage>;
			readonly key: string;
			readonly autoSave?: boolean;
			readonly saveDebounceMs?: number;
			readonly includeHistory?: boolean;
	  }
	| undefined {
	if (config.storage === undefined) return undefined;
	const storage =
		config.storage.directory === undefined
			? createMemoryStorage()
			: createFileStorage(config.storage.directory);
	return {
		storage,
		key: config.storage.key ?? config.station.id,
		...(config.storage.autoSave === undefined ? {} : { autoSave: config.storage.autoSave }),
		...(config.storage.saveDebounceMs === undefined
			? {}
			: { saveDebounceMs: config.storage.saveDebounceMs }),
		...(config.storage.includeHistory === undefined
			? {}
			: { includeHistory: config.storage.includeHistory }),
	};
}

function waitForConnection(
	simulator: CliSimulator,
	timeoutMs: number,
	requireReady: boolean,
): Promise<void> {
	if (simulator.isConnected() && (!requireReady || simulator.isReady)) return Promise.resolve();
	return new Promise<void>((resolve, reject) => {
		let settled = false;
		let unsubscribeConnection = (): void => undefined;
		let unsubscribeBoot = (): void => undefined;
		const timer = setTimeout(() => {
			finish(new Error(`Timed out after ${String(timeoutMs)} ms waiting for the CSMS`));
		}, timeoutMs);
		const finish = (error?: Error): void => {
			if (settled) return;
			settled = true;
			clearTimeout(timer);
			unsubscribeConnection();
			unsubscribeBoot();
			if (error === undefined) {
				resolve();
			} else {
				reject(error);
			}
		};
		unsubscribeConnection = simulator.on('connection', (event) => {
			if (event.state === 'connected') {
				if (!requireReady || simulator.isReady) finish();
			} else if (event.state === 'disconnected') {
				const code = event.close?.code;
				queueMicrotask(() => {
					if (simulator.getState().connection.state !== 'reconnecting') {
						finish(
							new Error(
								code === undefined
									? 'Could not connect to the CSMS'
									: `Could not connect to the CSMS (WebSocket close code ${String(code)})`,
							),
						);
					}
				});
			}
		});
		unsubscribeBoot = simulator.on('boot', (event) => {
			if (!requireReady) return;
			if (event.status === 'accepted') finish();
			else if (event.status === 'rejected' || event.status === 'error') {
				finish(new Error('BootNotification was not accepted'));
			}
		});
		try {
			simulator.connect();
		} catch (error) {
			finish(error instanceof Error ? error : new Error(String(error)));
		}
	});
}

function parseBoot(value: unknown): BootOptions {
	const record = requireRecord(value, 'config.boot');
	return {
		...(optionalBoolean(record, 'auto', 'config.boot.auto') === undefined
			? {}
			: { auto: optionalBoolean(record, 'auto', 'config.boot.auto') }),
		...(optionalBoolean(record, 'required', 'config.boot.required') === undefined
			? {}
			: { required: optionalBoolean(record, 'required', 'config.boot.required') }),
		...(optionalBoolean(record, 'retryOnPending', 'config.boot.retryOnPending') === undefined
			? {}
			: {
					retryOnPending: optionalBoolean(record, 'retryOnPending', 'config.boot.retryOnPending'),
				}),
		...(optionalNumber(record, 'retryIntervalMs', 'config.boot.retryIntervalMs', 0, {
			exclusiveMin: true,
		}) === undefined
			? {}
			: {
					retryIntervalMs: optionalNumber(
						record,
						'retryIntervalMs',
						'config.boot.retryIntervalMs',
						0,
						{ exclusiveMin: true },
					),
				}),
	};
}

function parseTiming(value: unknown): TimingOptions {
	const record = requireRecord(value, 'config.timing');
	return {
		...(optionalNumber(record, 'pendingCallTimeoutMs', 'config.timing.pendingCallTimeoutMs', 0, {
			exclusiveMin: true,
		}) === undefined
			? {}
			: {
					pendingCallTimeoutMs: optionalNumber(
						record,
						'pendingCallTimeoutMs',
						'config.timing.pendingCallTimeoutMs',
						0,
						{ exclusiveMin: true },
					),
				}),
		...(optionalNumber(record, 'heartbeatIntervalMs', 'config.timing.heartbeatIntervalMs', 0, {
			exclusiveMin: true,
		}) === undefined
			? {}
			: {
					heartbeatIntervalMs: optionalNumber(
						record,
						'heartbeatIntervalMs',
						'config.timing.heartbeatIntervalMs',
						0,
						{ exclusiveMin: true },
					),
				}),
		...(optionalNumber(record, 'meterValueIntervalMs', 'config.timing.meterValueIntervalMs', 0) ===
		undefined
			? {}
			: {
					meterValueIntervalMs: optionalNumber(
						record,
						'meterValueIntervalMs',
						'config.timing.meterValueIntervalMs',
						0,
					),
				}),
	};
}

function parseReconnect(value: unknown): ReconnectOptions {
	const record = requireRecord(value, 'config.reconnect');
	const reconnect: ReconnectOptions = {
		...(optionalBoolean(record, 'enabled', 'config.reconnect.enabled') === undefined
			? {}
			: { enabled: optionalBoolean(record, 'enabled', 'config.reconnect.enabled') }),
		...(optionalNumber(record, 'maxAttempts', 'config.reconnect.maxAttempts', 1, {
			integer: true,
		}) === undefined
			? {}
			: {
					maxAttempts: optionalNumber(record, 'maxAttempts', 'config.reconnect.maxAttempts', 1, {
						integer: true,
					}),
				}),
		...(optionalNumber(record, 'baseDelayMs', 'config.reconnect.baseDelayMs', 0, {
			exclusiveMin: true,
		}) === undefined
			? {}
			: {
					baseDelayMs: optionalNumber(record, 'baseDelayMs', 'config.reconnect.baseDelayMs', 0, {
						exclusiveMin: true,
					}),
				}),
		...(optionalNumber(record, 'maxDelayMs', 'config.reconnect.maxDelayMs', 0, {
			exclusiveMin: true,
		}) === undefined
			? {}
			: {
					maxDelayMs: optionalNumber(record, 'maxDelayMs', 'config.reconnect.maxDelayMs', 0, {
						exclusiveMin: true,
					}),
				}),
		...(optionalBoolean(record, 'jitter', 'config.reconnect.jitter') === undefined
			? {}
			: { jitter: optionalBoolean(record, 'jitter', 'config.reconnect.jitter') }),
	};
	if (
		reconnect.baseDelayMs !== undefined &&
		reconnect.maxDelayMs !== undefined &&
		reconnect.maxDelayMs < reconnect.baseDelayMs
	) {
		throw new Error('config.reconnect.maxDelayMs must be at least baseDelayMs');
	}
	return reconnect;
}

function parseFaults(value: unknown): Partial<FaultConfig> {
	const record = requireRecord(value, 'config.faults');
	return {
		...(optionalNumber(record, 'latencyMs', 'config.faults.latencyMs', 0, {
			max: 60_000,
		}) === undefined
			? {}
			: {
					latencyMs: optionalNumber(record, 'latencyMs', 'config.faults.latencyMs', 0, {
						max: 60_000,
					}),
				}),
		...(optionalNumber(record, 'dropRate', 'config.faults.dropRate', 0, { max: 1 }) === undefined
			? {}
			: {
					dropRate: optionalNumber(record, 'dropRate', 'config.faults.dropRate', 0, { max: 1 }),
				}),
		...(optionalNumber(record, 'malformRate', 'config.faults.malformRate', 0, { max: 1 }) ===
		undefined
			? {}
			: {
					malformRate: optionalNumber(record, 'malformRate', 'config.faults.malformRate', 0, {
						max: 1,
					}),
				}),
	};
}

function parseValidation(value: unknown): { readonly mode?: ValidateMode } {
	const record = requireRecord(value, 'config.validation');
	const mode = record['mode'];
	if (mode === undefined) return {};
	if (mode !== 'off' && mode !== 'warn' && mode !== 'block') {
		throw new Error('config.validation.mode must be "off", "warn", or "block"');
	}
	return { mode };
}

function parseInbound(value: unknown): { readonly policy?: InboundResponseMode } {
	const record = requireRecord(value, 'config.inbound');
	const policy = record['policy'];
	if (policy === undefined) return {};
	if (policy !== 'auto' && policy !== 'reject') {
		throw new Error('config.inbound.policy must be "auto" or "reject"');
	}
	return { policy };
}

function parseHistory(value: unknown): { readonly maxEntries?: number } {
	const record = requireRecord(value, 'config.history');
	const maxEntries = optionalNumber(record, 'maxEntries', 'config.history.maxEntries', 1, {
		integer: true,
	});
	return maxEntries === undefined ? {} : { maxEntries };
}

function parseStorage(value: unknown): CliStorageOptions {
	const record = requireRecord(value, 'config.storage');
	const directory = optionalString(record, 'directory', 'config.storage.directory');
	const key = optionalString(record, 'key', 'config.storage.key');
	const autoSave = optionalBoolean(record, 'autoSave', 'config.storage.autoSave');
	const saveDebounceMs = optionalNumber(
		record,
		'saveDebounceMs',
		'config.storage.saveDebounceMs',
		0,
	);
	const includeHistory = optionalBoolean(record, 'includeHistory', 'config.storage.includeHistory');
	return {
		...(directory === undefined ? {} : { directory }),
		...(key === undefined ? {} : { key }),
		...(autoSave === undefined ? {} : { autoSave }),
		...(saveDebounceMs === undefined ? {} : { saveDebounceMs }),
		...(includeHistory === undefined ? {} : { includeHistory }),
	};
}

function validateEntityFields(step: Record<string, unknown>, index: number): void {
	for (const name of ['entityId', 'connectorId', 'evseId']) {
		const value = step[name];
		if (
			value !== undefined &&
			(typeof value !== 'number' || !Number.isFinite(value) || value < 0)
		) {
			throw new Error(`scenario[${String(index)}].${name} must be a non-negative number`);
		}
	}
	for (const name of ['idToken', 'idTag', 'status', 'reason']) {
		const value = step[name];
		if (value !== undefined && typeof value !== 'string') {
			throw new Error(`scenario[${String(index)}].${name} must be a string`);
		}
	}
}

function requireRecord(value: unknown, label: string): Record<string, unknown> {
	if (typeof value !== 'object' || value === null || Array.isArray(value)) {
		throw new Error(`${label} must be an object`);
	}
	return value as Record<string, unknown>;
}

function requireString(record: Record<string, unknown>, key: string, label: string): string {
	const value = record[key];
	if (typeof value !== 'string' || value.trim() === '') {
		throw new Error(`${label} must be a non-empty string`);
	}
	return value;
}

function requireUrl(value: unknown, label: string): string {
	if (typeof value !== 'string' || value.trim() === '') {
		throw new Error(`${label} must be a non-empty string`);
	}
	let parsed: URL;
	try {
		parsed = new URL(value);
	} catch {
		throw new Error(`${label} must be a valid ws:// or wss:// URL`);
	}
	if (parsed.protocol !== 'ws:' && parsed.protocol !== 'wss:') {
		throw new Error(`${label} must use the ws:// or wss:// protocol`);
	}
	return value;
}

function optionalString(
	record: Record<string, unknown>,
	key: string,
	label: string,
): string | undefined {
	const value = record[key];
	if (value === undefined) return undefined;
	if (typeof value !== 'string' || value.trim() === '') {
		throw new Error(`${label} must be a non-empty string`);
	}
	return value;
}

function optionalBoolean(
	record: Record<string, unknown>,
	key: string,
	label: string,
): boolean | undefined {
	const value = record[key];
	if (value === undefined) return undefined;
	if (typeof value !== 'boolean') {
		throw new Error(`${label} must be a boolean`);
	}
	return value;
}

function optionalNumber(
	record: Record<string, unknown>,
	key: string,
	label: string,
	min: number,
	options: {
		readonly max?: number;
		readonly integer?: boolean;
		readonly exclusiveMin?: boolean;
	} = {},
): number | undefined {
	const value = record[key];
	if (value === undefined) return undefined;
	if (typeof value !== 'number' || !Number.isFinite(value)) {
		throw new Error(`${label} must be a finite number`);
	}
	if (options.integer === true && !Number.isInteger(value)) {
		throw new Error(`${label} must be an integer`);
	}
	if (options.exclusiveMin === true ? value <= min : value < min) {
		throw new Error(
			`${label} must be ${options.exclusiveMin === true ? 'greater than' : 'at least'} ${String(min)}`,
		);
	}
	if (options.max !== undefined && value > options.max) {
		throw new Error(`${label} must be at most ${String(options.max)}`);
	}
	return value;
}

function optionalInteger(
	record: Record<string, unknown>,
	key: string,
	label: string,
	min: number,
): number | undefined {
	return optionalNumber(record, key, label, min, { integer: true });
}

function optionalRecord<T>(
	record: Record<string, unknown>,
	key: string,
	parse: (value: unknown) => T,
): T | undefined {
	const value = record[key];
	return value === undefined ? undefined : parse(value);
}

function errorMessage(error: unknown): string {
	return error instanceof Error && error.message !== '' ? error.message : String(error);
}
