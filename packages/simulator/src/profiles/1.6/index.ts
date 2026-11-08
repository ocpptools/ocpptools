// SPDX-License-Identifier: Apache-2.0
// SPDX-FileCopyrightText: 2026 Rodolfo Carrillo

import type { JsonObject } from '@ocpptools/core';

import { EngineBase, type EngineProfile } from '../../engine.js';
import { SimulatorError, isAlreadyCountedError } from '../../errors.js';
import { isFiniteNumber, isInteger, isRecord } from '../../persistence.js';
import type { CallContext } from '../../rpc.js';
import {
	runScenario,
	scenarioEntityId,
	scenarioIdToken,
	type ScenarioOptions,
	type ScenarioRun,
	type ScenarioStep,
} from '../../scenario.js';
import type { CommonSimulatorOptions } from '../../state.js';

export type ConnectorStatus16 =
	| 'Available'
	| 'Preparing'
	| 'Charging'
	| 'SuspendedEV'
	| 'SuspendedEVSE'
	| 'Finishing'
	| 'Reserved'
	| 'Unavailable'
	| 'Faulted';

export interface ActiveTransaction16 {
	transactionId: number;
	idTag: string;
	meterStart: number;
	startedAt: number;
	lastMeterWh: number;
}

export interface Reservation16 {
	id: number;
	expiryDate: string;
	idTag: string;
}

export interface Connector16 {
	id: number;
	status: ConnectorStatus16;
	errorCode: string;
	meterWh: number;
	chargingPowerKw: number;
	activeTransaction: ActiveTransaction16 | null;
	reservation: Reservation16 | null;
	updatedAt: number;
}

export interface CompletedTransaction16 {
	connectorId: number;
	transactionId: number;
	idTag: string;
	meterStart: number;
	meterStop: number;
	energyWh: number;
	startedAt: number;
	stoppedAt: number;
	reason: string;
}

export interface LocalAuthorizationEntry {
	idTag: string;
	idTagInfo?: { status: string; expiryDate?: string; parentIdTag?: string };
}

export interface Simulator16State {
	connectors: Connector16[];
	completedTransactions: CompletedTransaction16[];
	localAuthorizationList: LocalAuthorizationEntry[];
	localListVersion: number;
	lastTransactionSeq: number;
	chargingProfiles: JsonObject[];
	compositeSchedules: Record<string, JsonObject>;
	defaultIdTag: string;
}

export interface Station16Options {
	readonly id: string;
	readonly vendor: string;
	readonly model: string;
	readonly firmwareVersion: string;
	readonly connectorCount?: number;
	readonly defaultIdTag?: string;
	readonly defaultChargingPowerKw?: number;
}

export interface Simulator16Options extends CommonSimulatorOptions {
	readonly station: Station16Options;
}

export interface Simulator16TransactionsApi {
	start(
		connectorId: number,
		idTag?: string,
		meterStart?: number,
	): Promise<{ ok: boolean; transactionId?: number; reason?: string }>;
	startSession(
		connectorId: number,
		idTag?: string,
	): Promise<{ ok: boolean; transactionId?: number; reason?: string }>;
	stop(connectorId: number, reason?: string): Promise<void>;
	meter(connectorId: number): Promise<void>;
	status(connectorId: number, status?: ConnectorStatus16): Promise<void>;
	get(connectorId: number): Connector16 | undefined;
}

export interface Simulator16LocalAuthApi {
	getVersion(): number;
	list(): LocalAuthorizationEntry[];
	clear(): void;
}

export interface Simulator16ReservationsApi {
	list(): Array<{ connectorId: number; reservation: Reservation16 }>;
}

export interface Simulator16ChargingProfilesApi {
	list(): JsonObject[];
	clear(): void;
}

export interface Simulator16AvailabilityApi {
	setStatus(connectorId: number, status: ConnectorStatus16, errorCode?: string): Promise<void>;
	setPower(connectorId: number, kw: number): void;
}

const meterLoops = new WeakMap<object, Map<number, () => void>>();

export function createSimulator16Profile(
	station: Station16Options,
): EngineProfile<Simulator16State> {
	const connectorCount = clampConnectors(station.connectorCount ?? 1);
	const defaultIdTag = station.defaultIdTag ?? 'AABBCCDD';
	const defaultPower = station.defaultChargingPowerKw ?? 0;

	return {
		version: '1.6',
		subprotocol: 'ocpp1.6',
		createState: () => ({
			connectors: Array.from({ length: connectorCount }, (_, index) => ({
				id: index + 1,
				status: 'Available',
				errorCode: 'NoError',
				meterWh: 0,
				chargingPowerKw: defaultPower,
				activeTransaction: null,
				reservation: null,
				updatedAt: 0,
			})),
			completedTransactions: [],
			localAuthorizationList: [],
			localListVersion: 0,
			lastTransactionSeq: 10_000,
			chargingProfiles: [],
			compositeSchedules: {},
			defaultIdTag,
		}),
		bootPayload: () => ({
			chargePointVendor: station.vendor,
			chargePointModel: station.model,
			firmwareVersion: station.firmwareVersion,
		}),
		applyBootResponse: (response) => ({
			status: typeof response['status'] === 'string' ? response['status'] : 'Rejected',
			...(typeof response['interval'] === 'number'
				? { intervalMs: response['interval'] * 1000 }
				: {}),
			...(typeof response['currentTime'] === 'string'
				? { currentTime: response['currentTime'] }
				: {}),
		}),
		register: (engine) => registerInbound(engine, station, defaultIdTag),
		restoreState: (value) => restoreSimulator16State(value),
		onRestored: (engine) => {
			if (engine.isReady) {
				for (const connector of engine.state.connectors) {
					if (connector.activeTransaction !== null) {
						startMeterLoop(engine, connector.id, engine.getMeterValueIntervalMs());
					}
				}
			}
		},
		onReady: async (engine) => {
			await sendAllStatusNotifications(engine);
			for (const connector of engine.state.connectors) {
				if (connector.activeTransaction !== null && connector.status === 'Charging') {
					startMeterLoop(engine, connector.id, engine.getMeterValueIntervalMs());
				}
			}
		},
		onTransportClose: (engine) => {
			const loops = meterLoops.get(engine);
			if (loops !== undefined) {
				for (const cancel of loops.values()) cancel();
				loops.clear();
			}
		},
	};
}

const CONNECTOR_STATUSES16: readonly ConnectorStatus16[] = [
	'Available',
	'Preparing',
	'Charging',
	'SuspendedEVSE',
	'SuspendedEV',
	'Finishing',
	'Reserved',
	'Unavailable',
	'Faulted',
];

function restoreSimulator16State(value: unknown): Simulator16State {
	if (!isRecord(value)) {
		throw new SimulatorError('invalid-snapshot', 'The 1.6 state must be an object');
	}
	const connectors = restoreConnectors16(value['connectors']);
	const completedTransactions = restoreCompletedTransactions16(value['completedTransactions']);
	const localAuthorizationList = restoreLocalAuthorizationList16(value['localAuthorizationList']);
	const localListVersion = value['localListVersion'];
	const lastTransactionSeq = value['lastTransactionSeq'];
	const chargingProfiles = value['chargingProfiles'];
	const compositeSchedules = value['compositeSchedules'];
	const defaultIdTag = value['defaultIdTag'];
	if (!isInteger(localListVersion) || localListVersion < 0) {
		throw new SimulatorError('invalid-snapshot', 'localListVersion is invalid');
	}
	if (!isInteger(lastTransactionSeq) || lastTransactionSeq < 0) {
		throw new SimulatorError('invalid-snapshot', 'lastTransactionSeq is invalid');
	}
	if (!Array.isArray(chargingProfiles) || !chargingProfiles.every(isRecord)) {
		throw new SimulatorError('invalid-snapshot', 'chargingProfiles is invalid');
	}
	if (!isRecord(compositeSchedules)) {
		throw new SimulatorError('invalid-snapshot', 'compositeSchedules is invalid');
	}
	const schedules: Record<string, JsonObject> = {};
	for (const [key, entry] of Object.entries(compositeSchedules)) {
		if (key === '__proto__' || key === 'constructor' || key === 'prototype' || !isRecord(entry)) {
			throw new SimulatorError('invalid-snapshot', 'compositeSchedules is invalid');
		}
		schedules[key] = { ...entry } as JsonObject;
	}
	if (typeof defaultIdTag !== 'string' || defaultIdTag === '') {
		throw new SimulatorError('invalid-snapshot', 'defaultIdTag is invalid');
	}
	if (connectors.length === 0) {
		throw new SimulatorError('invalid-snapshot', 'connectors must not be empty');
	}
	return {
		connectors,
		completedTransactions,
		localAuthorizationList,
		localListVersion,
		lastTransactionSeq,
		chargingProfiles: chargingProfiles.map((profile) => ({ ...profile }) as JsonObject),
		compositeSchedules: schedules,
		defaultIdTag,
	};
}

function restoreConnectors16(value: unknown): Connector16[] {
	if (!Array.isArray(value)) {
		throw new SimulatorError('invalid-snapshot', 'connectors must be an array');
	}
	return value.map((entry, index) => {
		if (!isRecord(entry)) {
			throw new SimulatorError('invalid-snapshot', `connectors[${index}] is invalid`);
		}
		const id = entry['id'];
		const status = entry['status'];
		const errorCode = entry['errorCode'];
		const meterWh = entry['meterWh'];
		const chargingPowerKw = entry['chargingPowerKw'];
		const activeTransaction = entry['activeTransaction'];
		const reservation = entry['reservation'];
		const updatedAt = entry['updatedAt'];
		if (!isInteger(id) || id < 1) {
			throw new SimulatorError('invalid-snapshot', `connectors[${index}].id is invalid`);
		}
		if (typeof status !== 'string' || !CONNECTOR_STATUSES16.includes(status as ConnectorStatus16)) {
			throw new SimulatorError('invalid-snapshot', `connectors[${index}].status is invalid`);
		}
		if (typeof errorCode !== 'string') {
			throw new SimulatorError('invalid-snapshot', `connectors[${index}].errorCode is invalid`);
		}
		if (!isFiniteNumber(meterWh) || meterWh < 0) {
			throw new SimulatorError('invalid-snapshot', `connectors[${index}].meterWh is invalid`);
		}
		if (!isFiniteNumber(chargingPowerKw) || chargingPowerKw < 0) {
			throw new SimulatorError(
				'invalid-snapshot',
				`connectors[${index}].chargingPowerKw is invalid`,
			);
		}
		if (!isFiniteNumber(updatedAt)) {
			throw new SimulatorError('invalid-snapshot', `connectors[${index}].updatedAt is invalid`);
		}
		return {
			id,
			status: status as ConnectorStatus16,
			errorCode,
			meterWh,
			chargingPowerKw,
			activeTransaction: restoreActiveTransaction16(activeTransaction, index),
			reservation: restoreReservation16(reservation, index),
			updatedAt,
		};
	});
}

function restoreActiveTransaction16(value: unknown, index: number): ActiveTransaction16 | null {
	if (value === null) {
		return null;
	}
	if (!isRecord(value)) {
		throw new SimulatorError(
			'invalid-snapshot',
			`connectors[${index}].activeTransaction is invalid`,
		);
	}
	const { transactionId, idTag, meterStart, startedAt, lastMeterWh } = value;
	if (
		!isInteger(transactionId) ||
		!isFiniteNumber(meterStart) ||
		meterStart < 0 ||
		!isFiniteNumber(startedAt) ||
		!isFiniteNumber(lastMeterWh)
	) {
		throw new SimulatorError(
			'invalid-snapshot',
			`connectors[${index}].activeTransaction is invalid`,
		);
	}
	if (typeof idTag !== 'string' || idTag === '') {
		throw new SimulatorError(
			'invalid-snapshot',
			`connectors[${index}].activeTransaction is invalid`,
		);
	}
	return { transactionId, idTag, meterStart, startedAt, lastMeterWh };
}

function restoreReservation16(value: unknown, index: number): Reservation16 | null {
	if (value === null) {
		return null;
	}
	if (!isRecord(value)) {
		throw new SimulatorError('invalid-snapshot', `connectors[${index}].reservation is invalid`);
	}
	const { id, expiryDate, idTag } = value;
	if (
		!isInteger(id) ||
		typeof expiryDate !== 'string' ||
		typeof idTag !== 'string' ||
		idTag === ''
	) {
		throw new SimulatorError('invalid-snapshot', `connectors[${index}].reservation is invalid`);
	}
	return { id, expiryDate, idTag };
}

function restoreCompletedTransactions16(value: unknown): CompletedTransaction16[] {
	if (!Array.isArray(value)) {
		throw new SimulatorError('invalid-snapshot', 'completedTransactions must be an array');
	}
	return value.map((entry, index) => {
		if (!isRecord(entry)) {
			throw new SimulatorError('invalid-snapshot', `completedTransactions[${index}] is invalid`);
		}
		const {
			connectorId,
			transactionId,
			idTag,
			meterStart,
			meterStop,
			energyWh,
			startedAt,
			stoppedAt,
			reason,
		} = entry;
		if (
			!isInteger(connectorId) ||
			!isInteger(transactionId) ||
			typeof idTag !== 'string' ||
			!isFiniteNumber(meterStart) ||
			!isFiniteNumber(meterStop) ||
			!isFiniteNumber(energyWh) ||
			!isFiniteNumber(startedAt) ||
			!isFiniteNumber(stoppedAt) ||
			typeof reason !== 'string'
		) {
			throw new SimulatorError('invalid-snapshot', `completedTransactions[${index}] is invalid`);
		}
		return {
			connectorId,
			transactionId,
			idTag,
			meterStart,
			meterStop,
			energyWh,
			startedAt,
			stoppedAt,
			reason,
		};
	});
}

function normalizeLocalAuthorizationList16(value: unknown): LocalAuthorizationEntry[] {
	if (!Array.isArray(value)) {
		return [];
	}
	const entries: LocalAuthorizationEntry[] = [];
	for (const entry of value) {
		if (!isRecord(entry) || typeof entry['idTag'] !== 'string' || entry['idTag'] === '') {
			continue;
		}
		const info = entry['idTagInfo'];
		entries.push({
			idTag: entry['idTag'],
			...(isRecord(info) && typeof info['status'] === 'string'
				? {
						idTagInfo: {
							status: info['status'],
							...(typeof info['expiryDate'] === 'string' ? { expiryDate: info['expiryDate'] } : {}),
							...(typeof info['parentIdTag'] === 'string'
								? { parentIdTag: info['parentIdTag'] }
								: {}),
						},
					}
				: {}),
		});
	}
	return entries;
}

function restoreLocalAuthorizationList16(value: unknown): LocalAuthorizationEntry[] {
	if (!Array.isArray(value)) {
		throw new SimulatorError('invalid-snapshot', 'localAuthorizationList must be an array');
	}
	return value.map((entry, index) => {
		if (!isRecord(entry) || typeof entry['idTag'] !== 'string') {
			throw new SimulatorError('invalid-snapshot', `localAuthorizationList[${index}] is invalid`);
		}
		const info = entry['idTagInfo'];
		if (info !== undefined) {
			if (!isRecord(info) || typeof info['status'] !== 'string') {
				throw new SimulatorError('invalid-snapshot', `localAuthorizationList[${index}] is invalid`);
			}
		}
		return {
			idTag: entry['idTag'],
			...(info === undefined
				? {}
				: {
						idTagInfo: {
							status: info['status'] as string,
							...(typeof info['expiryDate'] === 'string' ? { expiryDate: info['expiryDate'] } : {}),
							...(typeof info['parentIdTag'] === 'string'
								? { parentIdTag: info['parentIdTag'] }
								: {}),
						},
					}),
		};
	});
}

export function sendStatusNotification(
	engine: EngineBase<Simulator16State>,
	connector: Connector16,
	status: ConnectorStatus16,
	errorCode = 'NoError',
): Promise<void> {
	connector.status = status;
	connector.errorCode = errorCode;
	connector.updatedAt = engine.now();
	engine.events.emit({
		type: 'connector',
		at: engine.now(),
		connectorId: connector.id,
		status,
		meterWh: Math.round(connector.meterWh),
	});
	return engine
		.sendOrQueue('StatusNotification', {
			connectorId: connector.id,
			errorCode,
			status,
			timestamp: engine.ocppNow(),
		})
		.then(() => undefined);
}

export async function sendAllStatusNotifications(
	engine: EngineBase<Simulator16State>,
): Promise<void> {
	await engine.sendOrQueue('StatusNotification', {
		connectorId: 0,
		errorCode: 'NoError',
		status: 'Available',
		timestamp: engine.ocppNow(),
	});
	for (const connector of engine.state.connectors) {
		await sendStatusNotification(engine, connector, connector.status, connector.errorCode);
	}
}

export async function startChargingSession(
	engine: EngineBase<Simulator16State>,
	connectorId: number,
	idTag?: string,
): Promise<{ ok: boolean; transactionId?: number; reason?: string }> {
	const connector = engine.state.connectors.find((item) => item.id === connectorId);
	if (connector === undefined) return { ok: false, reason: 'invalid-connector' };
	if (connector.activeTransaction !== null) return { ok: false, reason: 'occupied' };
	if (connector.status !== 'Available' && connector.status !== 'Reserved') {
		return { ok: false, reason: 'not-available' };
	}
	const useIdTag = idTag ?? engine.state.defaultIdTag;
	if (
		connector.status === 'Reserved' &&
		connector.reservation !== null &&
		connector.reservation.idTag !== useIdTag
	) {
		return { ok: false, reason: 'reserved' };
	}
	try {
		await sendStatusNotification(engine, connector, 'Preparing');
	} catch (error) {
		await abortStart16(engine, connector);
		reportStartError16(engine, error);
		return { ok: false, reason: 'send-failed' };
	}
	try {
		const auth = await engine.sendCall('Authorize', { idTag: useIdTag });
		const authStatus = stringValue(
			(auth['idTagInfo'] as Record<string, unknown> | undefined)?.['status'],
			'Invalid',
		);
		if (authStatus !== 'Accepted') {
			await abortStart16(engine, connector);
			return { ok: false, reason: 'authorize-rejected' };
		}
		return await finalizeStartTransaction16(engine, connector, useIdTag);
	} catch (error) {
		reportStartError16(engine, error);
		await abortStart16(engine, connector);
		return { ok: false, reason: 'send-failed' };
	}
}

/**
 * Sends only StartTransaction, assumes the caller handled authorization and
 * leaves the connector in Preparing first.
 */
export async function startTransaction(
	engine: EngineBase<Simulator16State>,
	connectorId: number,
	idTag?: string,
	meterStart?: number,
): Promise<{ ok: boolean; transactionId?: number; reason?: string }> {
	const connector = engine.state.connectors.find((item) => item.id === connectorId);
	if (connector === undefined) return { ok: false, reason: 'invalid-connector' };
	if (connector.activeTransaction !== null) return { ok: false, reason: 'occupied' };
	if (connector.status !== 'Available' && connector.status !== 'Reserved') {
		return { ok: false, reason: 'not-available' };
	}
	const useIdTag = idTag ?? engine.state.defaultIdTag;
	if (
		connector.status === 'Reserved' &&
		connector.reservation !== null &&
		connector.reservation.idTag !== useIdTag
	) {
		return { ok: false, reason: 'reserved' };
	}
	if (meterStart !== undefined && (!Number.isInteger(meterStart) || meterStart < 0)) {
		return { ok: false, reason: 'invalid-meter-start' };
	}
	try {
		await sendStatusNotification(engine, connector, 'Preparing');
	} catch (error) {
		await abortStart16(engine, connector);
		reportStartError16(engine, error);
		return { ok: false, reason: 'send-failed' };
	}
	return finalizeStartTransaction16(engine, connector, useIdTag, meterStart);
}

async function finalizeStartTransaction16(
	engine: EngineBase<Simulator16State>,
	connector: Connector16,
	idTag: string,
	meterStart?: number,
): Promise<{ ok: boolean; transactionId?: number; reason?: string }> {
	if (meterStart !== undefined && (!Number.isInteger(meterStart) || meterStart < 0)) {
		return { ok: false, reason: 'invalid-meter-start' };
	}
	try {
		const startMeter = meterStart ?? Math.round(connector.meterWh);
		const payload: JsonObject = {
			connectorId: connector.id,
			idTag,
			meterStart: startMeter,
			timestamp: engine.ocppNow(),
		};
		if (connector.reservation !== null && connector.reservation.idTag === idTag) {
			payload['reservationId'] = connector.reservation.id;
		}
		const response = await engine.sendCall('StartTransaction', payload);
		const status = stringValue(
			(response['idTagInfo'] as Record<string, unknown> | undefined)?.['status'],
			'Invalid',
		);
		if (status !== 'Accepted') {
			await abortStart16(engine, connector);
			return { ok: false, reason: 'start-rejected' };
		}
		const transactionId =
			typeof response['transactionId'] === 'number'
				? response['transactionId']
				: nextTransactionId(engine);
		if (meterStart !== undefined) {
			connector.meterWh = meterStart;
		}
		connector.activeTransaction = {
			transactionId,
			idTag,
			meterStart: startMeter,
			startedAt: engine.now(),
			lastMeterWh: connector.meterWh,
		};
		connector.reservation = null;
		engine.events.emit({
			type: 'transaction',
			at: engine.now(),
			phase: 'started',
			protocol: '1.6',
			entityId: connector.id,
			transactionId,
		});
		await sendStatusNotification(engine, connector, 'Charging').catch((error: unknown) => {
			reportStartError16(engine, error);
		});
		try {
			startMeterLoop(engine, connector.id, engine.getMeterValueIntervalMs());
		} catch (error) {
			reportStartError16(engine, error);
		}
		return { ok: true, transactionId };
	} catch (error) {
		reportStartError16(engine, error);
		await abortStart16(engine, connector);
		return { ok: false, reason: 'send-failed' };
	}
}

function reportStartError16(engine: EngineBase<Simulator16State>, error: unknown): void {
	engine.events.emit({
		type: 'error',
		at: engine.now(),
		error: {
			name: 'SimulatorError',
			code: error instanceof SimulatorError ? error.code : 'internal-error',
			message: error instanceof Error ? error.message : 'Start failed',
		},
		fatal: false,
		countsAsError: !isAlreadyCountedError(error),
	});
}

async function abortStart16(
	engine: EngineBase<Simulator16State>,
	connector: Connector16,
): Promise<void> {
	await sendStatusNotification(
		engine,
		connector,
		connector.reservation !== null ? 'Reserved' : 'Available',
	).catch(() => undefined);
}

export async function sendMeterValues(
	engine: EngineBase<Simulator16State>,
	connectorId: number,
): Promise<void> {
	const connector = engine.state.connectors.find((item) => item.id === connectorId);
	if (connector === undefined) {
		throw new SimulatorError('invalid-options', 'Unknown connector');
	}
	const payload: JsonObject = {
		connectorId: connector.id,
		meterValue: [
			{
				timestamp: engine.ocppNow(),
				sampledValue: [
					{
						value: String(Math.round(connector.meterWh)),
						context: 'Sample.Periodic',
						format: 'Raw',
						measurand: 'Energy.Active.Import.Register',
						unit: 'Wh',
					},
				],
			},
		],
	};
	if (connector.activeTransaction !== null) {
		payload['transactionId'] = connector.activeTransaction.transactionId;
		connector.activeTransaction.lastMeterWh = connector.meterWh;
	}
	connector.updatedAt = engine.now();
	await engine.sendOrQueue('MeterValues', payload);
}

export async function stopTransaction(
	engine: EngineBase<Simulator16State>,
	connectorId: number,
	reason = 'Local',
): Promise<void> {
	const connector = engine.state.connectors.find((item) => item.id === connectorId);
	const tx = connector?.activeTransaction;
	if (connector === undefined || tx === null || tx === undefined) return;
	await sendStatusNotification(engine, connector, 'Finishing');
	stopMeterLoop(engine, connector.id);
	await engine.sendOrQueue('StopTransaction', {
		transactionId: tx.transactionId,
		meterStop: Math.round(connector.meterWh),
		timestamp: engine.ocppNow(),
		reason,
		idTag: tx.idTag,
	});
	const stoppedAt = engine.now();
	const meterStop = Math.round(connector.meterWh);
	engine.state.completedTransactions.push({
		connectorId: connector.id,
		transactionId: tx.transactionId,
		idTag: tx.idTag,
		meterStart: tx.meterStart,
		meterStop,
		energyWh: meterStop - tx.meterStart,
		startedAt: tx.startedAt,
		stoppedAt,
		reason,
	});
	engine.events.emit({
		type: 'transaction',
		at: engine.now(),
		phase: 'stopped',
		protocol: '1.6',
		entityId: connector.id,
		transactionId: tx.transactionId,
	});
	connector.activeTransaction = null;
	connector.updatedAt = engine.now();
	await sendStatusNotification(engine, connector, 'Available');
}

export function startMeterLoop(
	engine: EngineBase<Simulator16State>,
	connectorId: number,
	intervalMs: number,
): void {
	stopMeterLoop(engine, connectorId);
	const interval = intervalMs;
	if (!Number.isFinite(interval) || interval <= 0) return;
	let loops = meterLoops.get(engine);
	if (loops === undefined) {
		loops = new Map();
		meterLoops.set(engine, loops);
	}
	const cancel = engine.scheduler.setInterval(async () => {
		if (!engine.isReady) return;
		const connector = engine.state.connectors.find((item) => item.id === connectorId);
		if (connector?.activeTransaction === null || connector === undefined) return;
		if (connector.status !== 'Charging') return;
		if (connector.chargingPowerKw > 0) {
			connector.meterWh += connector.chargingPowerKw * 1000 * (interval / 3_600_000);
		}
		connector.activeTransaction.lastMeterWh = connector.meterWh;
		await engine.sendOrQueue('MeterValues', {
			connectorId: connector.id,
			transactionId: connector.activeTransaction.transactionId,
			meterValue: [
				{
					timestamp: engine.ocppNow(),
					sampledValue: [
						{
							value: String(Math.round(connector.meterWh)),
							context: 'Sample.Periodic',
							format: 'Raw',
							measurand: 'Energy.Active.Import.Register',
							unit: 'Wh',
						},
					],
				},
			],
		});
	}, interval);
	loops.set(connectorId, cancel);
}

export function stopMeterLoop(engine: EngineBase<Simulator16State>, connectorId: number): void {
	const loops = meterLoops.get(engine);
	const cancel = loops?.get(connectorId);
	cancel?.();
	loops?.delete(connectorId);
}

function registerInbound(
	engine: EngineBase<Simulator16State>,
	station: Station16Options,
	defaultIdTag: string,
): void {
	const rejectable: Record<string, JsonObject> = {
		RemoteStartTransaction: { status: 'Rejected' },
		RemoteStopTransaction: { status: 'Rejected' },
		Reset: { status: 'Rejected' },
		TriggerMessage: { status: 'Rejected' },
		ChangeAvailability: { status: 'Rejected' },
		ChangeConfiguration: { status: 'Rejected' },
		UnlockConnector: { status: 'UnlockFailed' },
		ReserveNow: { status: 'Rejected' },
		CancelReservation: { status: 'Rejected' },
	};
	const replies: Record<string, (context: CallContext) => void | Promise<void>> = {
		RemoteStartTransaction: async (context) => {
			const connectorId = Number(context.payload['connectorId'] ?? 1);
			const connector = engine.state.connectors.find((item) => item.id === connectorId);
			const idTag = stringValue(context.payload['idTag'], defaultIdTag);
			if (
				connector === undefined ||
				connector.activeTransaction !== null ||
				(connector.status !== 'Available' && connector.status !== 'Reserved') ||
				(connector.status === 'Reserved' &&
					connector.reservation !== null &&
					connector.reservation.idTag !== idTag)
			) {
				await context.reply({ status: 'Rejected' });
				return;
			}
			await context.reply({ status: 'Accepted' });
			await startChargingSession(engine, connectorId, idTag);
		},
		RemoteStopTransaction: async (context) => {
			const transactionId = Number(context.payload['transactionId'] ?? -1);
			const connector = engine.state.connectors.find(
				(item) => item.activeTransaction?.transactionId === transactionId,
			);
			if (connector === undefined) {
				await context.reply({ status: 'Rejected' });
				return;
			}
			await context.reply({ status: 'Accepted' });
			await stopTransaction(engine, connector.id, 'Remote');
		},
		ChangeConfiguration: async (context) => {
			const key = stringValue(context.payload['key'], '');
			const value = numberValue(context.payload['value'], Number.NaN);
			if (key === 'HeartbeatInterval' && Number.isFinite(value) && value > 0) {
				engine.setHeartbeatIntervalMs(value * 1000);
				await context.reply({ status: 'Accepted' });
				return;
			}
			if (key === 'MeterValueSampleInterval' && Number.isFinite(value) && value > 0) {
				engine.setMeterValueIntervalMs(value * 1000);
				for (const connector of engine.state.connectors) {
					if (connector.activeTransaction !== null && connector.status === 'Charging') {
						startMeterLoop(engine, connector.id, engine.getMeterValueIntervalMs());
					}
				}
				await context.reply({ status: 'Accepted' });
				return;
			}
			await context.reply({ status: key === 'LocalAuthListEnabled' ? 'Accepted' : 'Rejected' });
		},
		Reset: async (context) => {
			await context.reply({ status: 'Accepted' });
			for (const connector of engine.state.connectors) {
				if (connector.activeTransaction !== null) {
					await stopTransaction(engine, connector.id, 'Local');
				}
			}
		},
		TriggerMessage: async (context) => {
			await context.reply({ status: 'Accepted' });
			const requested = stringValue(context.payload['requestedMessage'], '');
			if (requested === 'Heartbeat') await engine.sendCall('Heartbeat', {});
			if (requested === 'StatusNotification') await sendAllStatusNotifications(engine);
		},
		GetConfiguration: async (context) => {
			const keys = [
				{
					key: 'HeartbeatInterval',
					readonly: false,
					value: String(engine.getHeartbeatIntervalMs() / 1000),
				},
				{
					key: 'MeterValueSampleInterval',
					readonly: false,
					value: String(engine.getMeterValueIntervalMs() / 1000),
				},
				{
					key: 'NumberOfConnectors',
					readonly: true,
					value: String(engine.state.connectors.length),
				},
				{ key: 'ChargePointVendor', readonly: true, value: station.vendor },
				{ key: 'ChargePointModel', readonly: true, value: station.model },
				{ key: 'FirmwareVersion', readonly: true, value: station.firmwareVersion },
			];
			const requested = Array.isArray(context.payload['key'])
				? (context.payload['key'] as string[])
				: [];
			const selected =
				requested.length === 0 ? keys : keys.filter((item) => requested.includes(item.key));
			const unknownKey = requested.filter((key) => !keys.some((item) => item.key === key));
			await context.reply({ configurationKey: selected, unknownKey });
		},
		ChangeAvailability: async (context) => {
			const connectorId = Number(context.payload['connectorId'] ?? 0);
			const type = stringValue(context.payload['type'], '');
			if (type !== 'Operative' && type !== 'Inoperative') {
				await context.reply({ status: 'Rejected' });
				return;
			}
			const status: ConnectorStatus16 = type === 'Inoperative' ? 'Unavailable' : 'Available';
			const targets =
				connectorId === 0
					? engine.state.connectors
					: engine.state.connectors.filter((item) => item.id === connectorId);
			const active = targets.some((item) => item.activeTransaction !== null);
			await context.reply({ status: active ? 'Scheduled' : 'Accepted' });
			for (const connector of targets) {
				if (connector.activeTransaction === null) {
					await sendStatusNotification(engine, connector, status);
				}
			}
		},
		UnlockConnector: async (context) => {
			const connector = engine.state.connectors.find(
				(item) => item.id === Number(context.payload['connectorId'] ?? 1),
			);
			if (connector === undefined) {
				await context.reply({ status: 'UnlockFailed' });
				return;
			}
			await context.reply({ status: 'Unlocked' });
			if (connector.activeTransaction !== null) {
				await stopTransaction(engine, connector.id, 'Remote');
			}
		},
		ClearCache: async (context) => {
			engine.state.localAuthorizationList = [];
			await context.reply({ status: 'Accepted' });
		},
		GetDiagnostics: async (context) => {
			await context.reply({ fileName: `diagnostics-${station.id}.txt` });
		},
		UpdateFirmware: async (context) => {
			await context.reply({});
		},
		GetLocalListVersion: async (context) => {
			await context.reply({ listVersion: engine.state.localListVersion });
		},
		SendLocalList: async (context) => {
			const updateType = stringValue(context.payload['updateType'], 'Full');
			const version = Number(context.payload['listVersion'] ?? 0);
			const list = normalizeLocalAuthorizationList16(context.payload['localAuthorizationList']);
			if (updateType === 'Full') {
				engine.state.localAuthorizationList = list;
				engine.state.localListVersion = version;
				await context.reply({ status: 'Accepted' });
				return;
			}
			if (updateType === 'Differential') {
				if (version <= engine.state.localListVersion) {
					await context.reply({ status: 'VersionMismatch' });
					return;
				}
				for (const entry of list) {
					const index = engine.state.localAuthorizationList.findIndex(
						(item) => item.idTag === entry.idTag,
					);
					if (index >= 0) engine.state.localAuthorizationList[index] = entry;
					else engine.state.localAuthorizationList.push(entry);
				}
				engine.state.localListVersion = version;
				await context.reply({ status: 'Accepted' });
				return;
			}
			await context.reply({ status: 'Failed' });
		},
		ReserveNow: async (context) => {
			const connector = engine.state.connectors.find(
				(item) => item.id === Number(context.payload['connectorId'] ?? 1),
			);
			if (connector === undefined || connector.status !== 'Available') {
				await context.reply({ status: 'Occupied' });
				return;
			}
			connector.reservation = {
				id: Number(context.payload['reservationId'] ?? 0),
				expiryDate: stringValue(context.payload['expiryDate'], ''),
				idTag: stringValue(context.payload['idTag'], ''),
			};
			await context.reply({ status: 'Accepted' });
			await sendStatusNotification(engine, connector, 'Reserved');
		},
		CancelReservation: async (context) => {
			const reservationId = Number(context.payload['reservationId'] ?? -1);
			const connector = engine.state.connectors.find(
				(item) => item.reservation?.id === reservationId,
			);
			if (connector === undefined) {
				await context.reply({ status: 'Rejected' });
				return;
			}
			connector.reservation = null;
			await context.reply({ status: 'Accepted' });
			await sendStatusNotification(engine, connector, 'Available');
		},
		DataTransfer: async (context) => {
			await context.reply({ status: 'Accepted' });
		},
		SetChargingProfile: async (context) => {
			engine.state.chargingProfiles.push(context.payload);
			await context.reply({ status: 'Accepted' });
		},
		ClearChargingProfile: async (context) => {
			engine.state.chargingProfiles = [];
			await context.reply({ status: 'Accepted' });
		},
		GetCompositeSchedule: async (context) => {
			const connectorId = Number(context.payload['connectorId'] ?? 0);
			const duration = Number(context.payload['duration'] ?? 3600);
			const unit = stringValue(context.payload['chargingRateUnit'], 'W');
			await context.reply({
				status: 'Accepted',
				connectorId,
				scheduleStart: engine.ocppNow(),
				chargingSchedule: {
					duration,
					chargingRateUnit: unit,
					chargingSchedulePeriod: [{ startPeriod: 0, limit: 32000, numberPhases: 3 }],
				},
			});
		},
	};

	for (const [action, handler] of Object.entries(replies)) {
		engine.onCall(action, async (context) => {
			if (engine.getInboundResponseMode() === 'reject' && rejectable[action] !== undefined) {
				await context.reply(rejectable[action]);
				return;
			}
			await handler(context);
		});
	}
}

function nextTransactionId(engine: EngineBase<Simulator16State>): number {
	engine.state.lastTransactionSeq += 1;
	return engine.state.lastTransactionSeq;
}

function numberValue(value: unknown, fallback: number): number {
	if (typeof value === 'number' && Number.isFinite(value)) return value;
	if (typeof value === 'string' && value.trim() !== '') {
		const parsed = Number(value);
		return Number.isFinite(parsed) ? parsed : fallback;
	}
	return fallback;
}

function stringValue(value: unknown, fallback: string): string {
	if (typeof value === 'string') return value;
	if (typeof value === 'number' || typeof value === 'boolean') return String(value);
	return fallback;
}

function clampConnectors(value: number): number {
	if (!Number.isFinite(value)) return 1;
	return Math.max(1, Math.min(8, Math.floor(value)));
}

function clone<T>(value: T): T {
	return JSON.parse(JSON.stringify(value)) as T;
}

export class Simulator16 extends EngineBase<Simulator16State> {
	override readonly version = '1.6' as const;
	readonly subprotocol = 'ocpp1.6' as const;
	readonly transactions: Simulator16TransactionsApi;
	readonly localAuth: Simulator16LocalAuthApi;
	readonly reservations: Simulator16ReservationsApi;
	readonly chargingProfiles: Simulator16ChargingProfilesApi;
	readonly availability: Simulator16AvailabilityApi;
	private readonly station: Station16Options;

	constructor(options: Simulator16Options) {
		super(createSimulator16Profile(options.station), options);
		this.station = options.station;
		this.transactions = {
			start: (connectorId, idTag, meterStart) =>
				startTransaction(this, connectorId, idTag ?? this.station.defaultIdTag, meterStart),
			startSession: (connectorId, idTag) =>
				startChargingSession(this, connectorId, idTag ?? this.station.defaultIdTag),
			stop: (connectorId, reason) => stopTransaction(this, connectorId, reason),
			meter: (connectorId) => sendMeterValues(this, connectorId),
			status: (connectorId, status) => this.sendStatusNotification(connectorId, status),
			get: (connectorId) => this.getConnector(connectorId),
		};
		this.localAuth = {
			getVersion: () => this.state.localListVersion,
			list: () => this.state.localAuthorizationList.map((entry) => clone(entry)),
			clear: () => {
				this.state.localAuthorizationList = [];
			},
		};
		this.reservations = {
			list: () =>
				this.state.connectors
					.filter((connector) => connector.reservation !== null)
					.map((connector) => ({
						connectorId: connector.id,
						reservation: clone(connector.reservation as Reservation16),
					})),
		};
		this.chargingProfiles = {
			list: () => this.state.chargingProfiles.map((profile) => clone(profile)),
			clear: () => {
				this.state.chargingProfiles = [];
			},
		};
		this.availability = {
			setStatus: (connectorId, status, errorCode) =>
				this.sendStatusNotification(connectorId, status, errorCode),
			setPower: (connectorId, kw) => this.setChargingPowerKw(connectorId, kw),
		};
	}

	sendHeartbeat(): Promise<JsonObject> {
		return this.sendCall('Heartbeat', {});
	}

	sendStatusNotification(
		connectorId: number,
		status?: ConnectorStatus16,
		errorCode = 'NoError',
	): Promise<void> {
		const connector = this.state.connectors.find((item) => item.id === connectorId);
		if (connector === undefined) {
			return Promise.reject(new SimulatorError('invalid-options', 'Unknown connector'));
		}
		return sendStatusNotification(this, connector, status ?? connector.status, errorCode);
	}

	sendAllStatusNotifications(): Promise<void> {
		return sendAllStatusNotifications(this);
	}

	authorize(idTag: string): Promise<JsonObject> {
		return this.sendCall('Authorize', { idTag });
	}

	startChargingSession(
		connectorId: number,
		idTag?: string,
	): Promise<{ ok: boolean; transactionId?: number; reason?: string }> {
		return startChargingSession(this, connectorId, idTag ?? this.station.defaultIdTag);
	}

	startTransaction(
		connectorId: number,
		idTag?: string,
		meterStart?: number,
	): Promise<{ ok: boolean; transactionId?: number; reason?: string }> {
		return startTransaction(this, connectorId, idTag ?? this.station.defaultIdTag, meterStart);
	}

	sendMeterValues(connectorId: number): Promise<void> {
		return sendMeterValues(this, connectorId);
	}

	stopTransaction(connectorId: number, reason = 'Local'): Promise<void> {
		return stopTransaction(this, connectorId, reason);
	}

	setConnectorStatus(connectorId: number, status: ConnectorStatus16, errorCode = 'NoError'): void {
		const connector = this.state.connectors.find((item) => item.id === connectorId);
		if (connector === undefined) return;
		connector.status = status;
		connector.errorCode = errorCode;
		connector.updatedAt = this.now();
	}

	setChargingPowerKw(connectorId: number, kw: number): void {
		const connector = this.state.connectors.find((item) => item.id === connectorId);
		if (connector !== undefined) connector.chargingPowerKw = Math.max(0, kw);
	}

	getConnector(connectorId: number): Connector16 | undefined {
		return this.state.connectors.find((item) => item.id === connectorId);
	}

	sendDiagnosticsStatus(status: string): Promise<'sent' | 'queued'> {
		return this.sendOrQueue('DiagnosticsStatusNotification', { status });
	}

	sendFirmwareStatus(status: string): Promise<'sent' | 'queued'> {
		return this.sendOrQueue('FirmwareStatusNotification', { status });
	}

	sendDataTransfer(payload: JsonObject): Promise<JsonObject> {
		return this.sendCall('DataTransfer', payload);
	}

	runScenario(steps: readonly ScenarioStep[], options: ScenarioOptions = {}): ScenarioRun {
		return runScenario(
			this,
			{
				boot: () => this.bootNotification(),
				heartbeat: () => this.sendHeartbeat(),
				status: (step) =>
					this.sendStatusNotification(
						scenarioEntityId(step),
						step.status as ConnectorStatus16 | undefined,
					),
				authorize: async (step) => {
					const response = await this.authorize(
						scenarioIdToken(step) ?? this.station.defaultIdTag ?? this.state.defaultIdTag,
					);
					const info = response['idTagInfo'] as Record<string, unknown> | undefined;
					return info?.['status'] === 'Accepted';
				},
				start: (step) => this.startChargingSession(scenarioEntityId(step), scenarioIdToken(step)),
				meter: (step) => this.sendMeterValues(scenarioEntityId(step)),
				stop: (step) => this.stopTransaction(scenarioEntityId(step), step.reason),
				call: (action, payload) => this.sendCall(action, payload),
			},
			steps,
			options,
		);
	}

	runChargingScenario(options: {
		connectorId?: number;
		idTag?: string;
		durationMs?: number;
		readings?: number;
	}): { cancel: () => void; done: Promise<boolean> } {
		const connectorId = options.connectorId ?? 1;
		const readings = Math.max(0, options.readings ?? 1);
		const duration = Math.max(1000, options.durationMs ?? 5000);
		const waitMs = Math.floor(duration / (readings + 1));
		const steps: ScenarioStep[] = [
			{ type: 'start', entityId: connectorId, idToken: options.idTag },
			...Array.from({ length: readings }, (): ScenarioStep[] => [
				{ type: 'wait', ms: waitMs },
				{ type: 'meter', entityId: connectorId },
			]).flat(),
			{ type: 'stop', entityId: connectorId, reason: 'Local' },
		];
		const run = this.runScenario(steps);
		return {
			cancel: () => run.cancel(),
			done: run.done.then((result) => result.status === 'completed'),
		};
	}
}
