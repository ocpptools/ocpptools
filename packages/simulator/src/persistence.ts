// SPDX-License-Identifier: Apache-2.0
// SPDX-FileCopyrightText: 2026 Rodolfo Carrillo

import type { JsonObject, OcppVersion } from '@ocpptools/core';

import type { InboundResponseMode, ValidateMode } from './events.js';
import type { SimulatorErrorSnapshot } from './errors.js';
import type { SimulatorLogEntry } from './log.js';
import type { QueueSnapshot } from './queue.js';
import type { FaultConfig } from './state.js';

export interface SimulatorPersistedConfig {
	readonly faults: FaultConfig;
	readonly validationMode: ValidateMode;
	readonly inboundResponseMode: InboundResponseMode;
	readonly heartbeatIntervalMs: number;
	readonly meterValueIntervalMs: number;
}

export interface SimulatorSnapshot {
	readonly snapshotVersion: 1;
	readonly protocol: OcppVersion;
	readonly savedAt: number;
	readonly config: SimulatorPersistedConfig;
	readonly state: JsonObject;
	readonly queue: QueueSnapshot;
	readonly history?: readonly SimulatorLogEntry[];
}

export interface LoadResult {
	readonly loaded: boolean;
	readonly snapshot?: SimulatorSnapshot;
	readonly error?: SimulatorErrorSnapshot;
}

export interface SaveResult {
	readonly saved: boolean;
	readonly error?: SimulatorErrorSnapshot;
}

export interface RestoreResult {
	readonly restored: boolean;
	readonly error?: SimulatorErrorSnapshot;
}

const SNAPSHOT_VERSION = 1;
const PROTOCOLS: readonly OcppVersion[] = ['1.6', '2.0.1'];

export function isRecord(value: unknown): value is Record<string, unknown> {
	return typeof value === 'object' && value !== null && !Array.isArray(value);
}

export function isFiniteNumber(value: unknown): value is number {
	return typeof value === 'number' && Number.isFinite(value);
}

export function isInteger(value: unknown): value is number {
	return typeof value === 'number' && Number.isInteger(value);
}

/** Deep-copies a JSON-compatible value, rejecting functions and non-finite numbers. */
export function cloneJson<T>(value: T, path = 'value'): T {
	if (value === null || typeof value === 'string' || typeof value === 'boolean') {
		return value;
	}
	if (typeof value === 'number') {
		if (!Number.isFinite(value)) {
			throw new Error(`${path} is not a finite number`);
		}
		return value;
	}
	if (Array.isArray(value)) {
		return (value as unknown[]).map((entry, index) =>
			cloneJson<unknown>(entry, `${path}[${index}]`),
		) as T;
	}
	if (isRecord(value)) {
		const result: Record<string, unknown> = {};
		for (const [key, entry] of Object.entries(value)) {
			if (entry === undefined) {
				throw new Error(`${path}.${key} is undefined`);
			}
			result[key] = cloneJson(entry, `${path}.${key}`);
		}
		return result as T;
	}
	throw new Error(`${path} is not JSON-serializable`);
}

export function validateSnapshot(
	snapshot: unknown,
	protocol: OcppVersion,
): asserts snapshot is SimulatorSnapshot {
	if (!isRecord(snapshot)) {
		throw new Error('The snapshot must be an object');
	}
	if (snapshot['snapshotVersion'] !== SNAPSHOT_VERSION) {
		throw new Error(`Unsupported snapshot version: ${String(snapshot['snapshotVersion'])}`);
	}
	if (
		typeof snapshot['protocol'] !== 'string' ||
		!PROTOCOLS.includes(snapshot['protocol'] as OcppVersion) ||
		snapshot['protocol'] !== protocol
	) {
		throw new Error(`The snapshot protocol does not match ${protocol}`);
	}
	if (!isFiniteNumber(snapshot['savedAt']) || snapshot['savedAt'] < 0) {
		throw new Error('savedAt must be a non-negative number');
	}
	if (!isRecord(snapshot['state'])) {
		throw new Error('state must be an object');
	}
	if (!isRecord(snapshot['config'])) {
		throw new Error('config must be an object');
	}
	validateConfig(snapshot['config']);
	validateQueueSnapshot(snapshot['queue']);
	if (snapshot['history'] !== undefined) {
		validateHistory(snapshot['history']);
	}
}

export function validateConfig(config: Record<string, unknown>): void {
	const faults = config['faults'];
	if (!isRecord(faults)) {
		throw new Error('config.faults must be an object');
	}
	const latency = faults['latencyMs'];
	const drop = faults['dropRate'];
	const malform = faults['malformRate'];
	if (!isFiniteNumber(latency) || latency < 0 || latency > 60_000) {
		throw new Error('config.faults.latencyMs is invalid');
	}
	if (!isFiniteNumber(drop) || drop < 0 || drop > 1) {
		throw new Error('config.faults.dropRate is invalid');
	}
	if (!isFiniteNumber(malform) || malform < 0 || malform > 1) {
		throw new Error('config.faults.malformRate is invalid');
	}
	if (
		config['validationMode'] !== 'off' &&
		config['validationMode'] !== 'warn' &&
		config['validationMode'] !== 'block'
	) {
		throw new Error('config.validationMode is invalid');
	}
	if (config['inboundResponseMode'] !== 'auto' && config['inboundResponseMode'] !== 'reject') {
		throw new Error('config.inboundResponseMode is invalid');
	}
	if (!isFiniteNumber(config['heartbeatIntervalMs']) || config['heartbeatIntervalMs'] <= 0) {
		throw new Error('config.heartbeatIntervalMs is invalid');
	}
	if (!isFiniteNumber(config['meterValueIntervalMs']) || config['meterValueIntervalMs'] < 0) {
		throw new Error('config.meterValueIntervalMs is invalid');
	}
}

export function validateQueueSnapshot(value: unknown): asserts value is QueueSnapshot {
	if (!isRecord(value) || value['version'] !== 1 || !Array.isArray(value['entries'])) {
		throw new Error('queue must be a version 1 snapshot');
	}
	if (!value['entries'].every((entry) => typeof entry === 'string')) {
		throw new Error('queue entries must be strings');
	}
}

export function validateHistory(value: unknown): asserts value is readonly SimulatorLogEntry[] {
	if (!Array.isArray(value)) {
		throw new Error('history must be an array');
	}
	for (const entry of value) {
		if (
			!isRecord(entry) ||
			!isFiniteNumber(entry['at']) ||
			(entry['direction'] !== 'sent' &&
				entry['direction'] !== 'received' &&
				entry['direction'] !== 'system') ||
			(entry['messageType'] !== 'CALL' &&
				entry['messageType'] !== 'CALLRESULT' &&
				entry['messageType'] !== 'CALLERROR' &&
				entry['messageType'] !== 'SYSTEM') ||
			typeof entry['action'] !== 'string'
		) {
			throw new Error('history contains an invalid entry');
		}
	}
}
