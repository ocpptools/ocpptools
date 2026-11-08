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

export interface ChargingProfile16 {
	connectorId: number;
	id: number;
	stackLevel: number;
	purpose: string;
	kind: string;
	schedule: JsonObject;
	periods: Array<{ startPeriod: number; limit: number; numberPhases?: number }>;
	validFrom?: string;
	validTo?: string;
	transactionId?: number;
	receivedAt?: number;
}

export interface Connector16 {
	id: number;
	status: ConnectorStatus16;
	errorCode: string;
	meterWh: number;
	chargingPowerKw: number;
	activeTransaction: ActiveTransaction16 | null;
	reservation: Reservation16 | null;
	pendingAvailability?: 'Operative' | 'Inoperative';
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
	chargingProfiles: ChargingProfile16[];
	compositeSchedules: Record<string, JsonObject>;
	defaultIdTag: string;
	configuration?: Record<string, string>;
	diagnosticsStatus?: string;
	firmwareStatus?: string;
	pendingReboot?: boolean;
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
	list(): ChargingProfile16[];
	clear(): void;
}

export interface Simulator16AvailabilityApi {
	setStatus(connectorId: number, status: ConnectorStatus16, errorCode?: string): Promise<void>;
	setPower(connectorId: number, kw: number): void;
}

const meterLoops = new WeakMap<object, Map<number, () => void>>();
const reservationTimers = new WeakMap<object, Map<number, () => void>>();
const statusFlows = new WeakMap<object, Map<string, Array<() => void>>>();
const MAX_TIMER_DELAY = 2_147_483_647;
const stopOperations = new WeakMap<object, Promise<void>>();

const CONFIGURATION_BOOLEAN_KEYS: readonly string[] = [
	'LocalAuthListEnabled',
	'AuthorizationCacheEnabled',
	'AllowOfflineTxForUnknownId',
	'StopTransactionOnEVSideDisconnect',
];
const CONFIGURATION_NUMERIC_KEYS: readonly string[] = [
	'ConnectionTimeOut',
	'ClockAlignedDataInterval',
	'ResetRetries',
	'LocalAuthListMaxLength',
	'SendLocalListMaxLength',
	'TransactionMessageAttempts',
	'TransactionMessageRetryInterval',
];
const READONLY_CONFIGURATION_KEYS: readonly string[] = [
	'SupportedFeatureProfiles',
	'ChargePointVendor',
	'ChargePointModel',
	'ChargePointSerialNumber',
	'FirmwareVersion',
	'NumberOfConnectors',
	'LocalAuthListMaxLength',
	'SendLocalListMaxLength',
];

interface ConfigurationEntry16 {
	readonly key: string;
	readonly readonly: boolean;
	readonly value: string;
}

function configurationEntries16(
	engine: EngineBase<Simulator16State>,
	station: Station16Options,
): ConfigurationEntry16[] {
	const stored = engine.state.configuration ?? {};
	const fallback: Record<string, string> = {
		HeartbeatInterval: String(engine.getHeartbeatIntervalMs() / 1000),
		MeterValueSampleInterval: String(engine.getMeterValueIntervalMs() / 1000),
		ConnectionTimeOut: '60',
		MeterValuesAlignedData: '',
		ClockAlignedDataInterval: '0',
		ResetRetries: '3',
		LocalAuthListEnabled: 'true',
		LocalAuthListMaxLength: '1000',
		SendLocalListMaxLength: '1000',
		AuthorizationCacheEnabled: 'false',
		AllowOfflineTxForUnknownId: 'false',
		TransactionMessageAttempts: '3',
		TransactionMessageRetryInterval: '60',
		StopTransactionOnEVSideDisconnect: 'true',
		SupportedFeatureProfiles:
			'Core,SmartCharging,LocalAuthListManagement,RemoteTrigger,Reservation,FirmwareManagement',
		ChargePointVendor: station.vendor,
		ChargePointModel: station.model,
		ChargePointSerialNumber: '',
		FirmwareVersion: station.firmwareVersion,
		NumberOfConnectors: String(engine.state.connectors.length),
	};
	return Object.entries(fallback).map(([key, value]) => ({
		key,
		readonly: READONLY_CONFIGURATION_KEYS.includes(key),
		value:
			key === 'HeartbeatInterval'
				? String(engine.getHeartbeatIntervalMs() / 1000)
				: key === 'MeterValueSampleInterval'
					? String(engine.getMeterValueIntervalMs() / 1000)
					: (stored[key] ?? value),
	}));
}

function applyConfiguration16(
	engine: EngineBase<Simulator16State>,
	key: string,
	value: string,
): { status: 'Accepted' | 'Rejected' | 'NotSupported' } {
	const entries = configurationEntries16(engine, {
		id: '',
		vendor: '',
		model: '',
		firmwareVersion: '',
	});
	const entry = entries.find((item) => item.key === key);
	if (entry === undefined) return { status: 'NotSupported' };
	if (entry.readonly) return { status: 'Rejected' };
	if (CONFIGURATION_BOOLEAN_KEYS.includes(key)) {
		if (value !== 'true' && value !== 'false') return { status: 'Rejected' };
	} else if (CONFIGURATION_NUMERIC_KEYS.includes(key)) {
		if (!/^\d+$/.test(value)) return { status: 'Rejected' };
	}
	if (key === 'HeartbeatInterval') {
		const seconds = Number(value);
		if (!Number.isInteger(seconds) || seconds <= 0) return { status: 'Rejected' };
		engine.setHeartbeatIntervalMs(seconds * 1000);
	} else if (key === 'MeterValueSampleInterval') {
		const seconds = Number(value);
		if (!Number.isInteger(seconds) || seconds < 0) return { status: 'Rejected' };
		engine.setMeterValueIntervalMs(seconds * 1000);
		for (const connector of engine.state.connectors) {
			if (connector.activeTransaction !== null && connector.status === 'Charging') {
				startMeterLoop(engine, connector.id, engine.getMeterValueIntervalMs());
			}
		}
	}
	engine.state.configuration = {
		...(engine.state.configuration ?? {}),
		[key]: value,
	};
	return { status: 'Accepted' };
}

function cancelStatusFlow16(engine: EngineBase<Simulator16State>, kind: string): void {
	const flows = statusFlows.get(engine);
	const cancels = flows?.get(kind);
	if (cancels === undefined) return;
	for (const cancel of cancels) cancel();
	cancels.length = 0;
	flows?.delete(kind);
}

function scheduleStatus16(
	engine: EngineBase<Simulator16State>,
	kind: string,
	delayMs: number,
	callback: () => void | Promise<void>,
): void {
	const flows = statusFlows.get(engine) ?? new Map<string, Array<() => void>>();
	statusFlows.set(engine, flows);
	const cancels = flows.get(kind) ?? [];
	flows.set(kind, cancels);
	cancels.push(engine.scheduler.setTimeout(callback, delayMs));
}

function startDiagnostics16(engine: EngineBase<Simulator16State>, station: Station16Options): void {
	cancelStatusFlow16(engine, 'diagnostics');
	engine.state.diagnosticsStatus = 'Uploading';
	void engine
		.sendOrQueue('DiagnosticsStatusNotification', { status: 'Uploading' })
		.catch((error: unknown) => reportStartError16(engine, error));
	scheduleStatus16(engine, 'diagnostics', 1000, async () => {
		engine.state.diagnosticsStatus = 'Uploaded';
		await engine.sendOrQueue('DiagnosticsStatusNotification', { status: 'Uploaded' });
	});
	void station;
}

function startFirmwareUpdate16(engine: EngineBase<Simulator16State>): void {
	cancelStatusFlow16(engine, 'firmware');
	engine.state.firmwareStatus = 'Downloading';
	void engine
		.sendOrQueue('FirmwareStatusNotification', { status: 'Downloading' })
		.catch((error: unknown) => reportStartError16(engine, error));
	scheduleStatus16(engine, 'firmware', 1000, async () => {
		engine.state.firmwareStatus = 'Downloaded';
		await engine.sendOrQueue('FirmwareStatusNotification', { status: 'Downloaded' });
	});
	scheduleStatus16(engine, 'firmware', 2000, async () => {
		engine.state.firmwareStatus = 'Installing';
		await engine.sendOrQueue('FirmwareStatusNotification', { status: 'Installing' });
	});
	scheduleStatus16(engine, 'firmware', 3000, async () => {
		engine.state.firmwareStatus = 'Installed';
		await engine.sendOrQueue('FirmwareStatusNotification', { status: 'Installed' });
	});
}

function cancelReservationTimer16(engine: EngineBase<Simulator16State>, connectorId: number): void {
	const timers = reservationTimers.get(engine);
	const cancel = timers?.get(connectorId);
	cancel?.();
	timers?.delete(connectorId);
}

function armReservationTimer16(engine: EngineBase<Simulator16State>, connector: Connector16): void {
	cancelReservationTimer16(engine, connector.id);
	const reservation = connector.reservation;
	if (reservation === null) return;
	const expiry = Date.parse(reservation.expiryDate);
	if (!Number.isFinite(expiry)) return;
	const remaining = expiry - Date.parse(engine.ocppNow());
	if (remaining <= 0) {
		void expireReservation16(engine, connector);
		return;
	}
	const timers = reservationTimers.get(engine) ?? new Map<number, () => void>();
	reservationTimers.set(engine, timers);
	timers.set(
		connector.id,
		engine.scheduler.setTimeout(
			() => {
				if (Date.parse(engine.ocppNow()) < expiry) {
					armReservationTimer16(engine, connector);
					return;
				}
				void expireReservation16(engine, connector);
			},
			Math.min(remaining, MAX_TIMER_DELAY),
		),
	);
}

async function expireReservation16(
	engine: EngineBase<Simulator16State>,
	connector: Connector16,
): Promise<void> {
	const reservation = connector.reservation;
	if (reservation === null) return;
	cancelReservationTimer16(engine, connector.id);
	connector.reservation = null;
	if (connector.status === 'Reserved') {
		await sendStatusNotification(engine, connector, 'Available').catch(() => undefined);
	}
	engine.events.emit({
		type: 'reservation',
		at: engine.now(),
		phase: 'expired',
		connectorId: connector.id,
		reservationId: reservation.id,
	});
}

export function rearmReservations16(engine: EngineBase<Simulator16State>): void {
	for (const connector of engine.state.connectors) {
		armReservationTimer16(engine, connector);
	}
}

function cancelAllStatusFlows16(engine: EngineBase<Simulator16State>): void {
	const flows = statusFlows.get(engine);
	if (flows !== undefined) {
		for (const cancels of flows.values()) {
			for (const cancel of cancels) cancel();
		}
		flows.clear();
	}
	const timers = reservationTimers.get(engine);
	if (timers !== undefined) {
		for (const cancel of timers.values()) cancel();
		timers.clear();
	}
}

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
			cancelAllStatusFlows16(engine);
			rearmReservations16(engine);
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
			rearmReservations16(engine);
			for (const connector of engine.state.connectors) {
				if (connector.activeTransaction !== null && connector.status === 'Charging') {
					startMeterLoop(engine, connector.id, engine.getMeterValueIntervalMs());
				}
			}
		},
		onTransportClose: (engine) => {
			cancelAllStatusFlows16(engine);
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
	const configuration = value['configuration'];
	const diagnosticsStatus = value['diagnosticsStatus'];
	const firmwareStatus = value['firmwareStatus'];
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
	if (configuration !== undefined && !isRecord(configuration)) {
		throw new SimulatorError('invalid-snapshot', 'configuration is invalid');
	}
	const restoredConfiguration: Record<string, string> = {};
	for (const [key, entry] of Object.entries(configuration ?? {})) {
		if (typeof entry !== 'string') {
			throw new SimulatorError('invalid-snapshot', 'configuration is invalid');
		}
		restoredConfiguration[key] = entry;
	}
	if (diagnosticsStatus !== undefined && typeof diagnosticsStatus !== 'string') {
		throw new SimulatorError('invalid-snapshot', 'diagnosticsStatus is invalid');
	}
	if (firmwareStatus !== undefined && typeof firmwareStatus !== 'string') {
		throw new SimulatorError('invalid-snapshot', 'firmwareStatus is invalid');
	}
	return {
		connectors,
		completedTransactions,
		localAuthorizationList,
		localListVersion,
		lastTransactionSeq,
		chargingProfiles: restoreChargingProfiles16(chargingProfiles),
		compositeSchedules: schedules,
		defaultIdTag,
		...(configuration === undefined ? {} : { configuration: restoredConfiguration }),
		...(diagnosticsStatus === undefined ? {} : { diagnosticsStatus }),
		...(firmwareStatus === undefined ? {} : { firmwareStatus }),
	};
}

function restoreChargingProfiles16(value: unknown): ChargingProfile16[] {
	if (!Array.isArray(value)) {
		throw new SimulatorError('invalid-snapshot', 'chargingProfiles is invalid');
	}
	return value.map((profile, index) => {
		if (isRecord(profile) && isRecord(profile['csChargingProfiles'])) {
			const connectorId = isInteger(profile['connectorId']) ? profile['connectorId'] : 0;
			const migrated = parseChargingProfile16(connectorId, profile as unknown as JsonObject);
			if (migrated === undefined) {
				throw new SimulatorError('invalid-snapshot', `chargingProfiles[${index}] is invalid`);
			}
			return migrated;
		}
		if (
			!isRecord(profile) ||
			!isInteger(profile['connectorId']) ||
			!isInteger(profile['id']) ||
			!isInteger(profile['stackLevel']) ||
			typeof profile['purpose'] !== 'string' ||
			typeof profile['kind'] !== 'string' ||
			!isRecord(profile['schedule']) ||
			!Array.isArray(profile['periods'])
		) {
			throw new SimulatorError('invalid-snapshot', `chargingProfiles[${index}] is invalid`);
		}
		const periods = profile['periods'].map((period) => {
			if (
				!isRecord(period) ||
				!isFiniteNumber(period['startPeriod']) ||
				!isFiniteNumber(period['limit'])
			) {
				throw new SimulatorError('invalid-snapshot', `chargingProfiles[${index}] is invalid`);
			}
			return {
				startPeriod: period['startPeriod'],
				limit: period['limit'],
				...(isInteger(period['numberPhases']) ? { numberPhases: period['numberPhases'] } : {}),
			};
		});
		const validFrom = profile['validFrom'];
		const validTo = profile['validTo'];
		const transactionId = profile['transactionId'];
		const receivedAt = profile['receivedAt'];
		if (
			(validFrom !== undefined &&
				(typeof validFrom !== 'string' || !Number.isFinite(Date.parse(validFrom)))) ||
			(validTo !== undefined &&
				(typeof validTo !== 'string' || !Number.isFinite(Date.parse(validTo)))) ||
			(transactionId !== undefined && !isInteger(transactionId)) ||
			(receivedAt !== undefined && !isFiniteNumber(receivedAt))
		) {
			throw new SimulatorError('invalid-snapshot', `chargingProfiles[${index}] is invalid`);
		}
		return {
			connectorId: profile['connectorId'],
			id: profile['id'],
			stackLevel: profile['stackLevel'],
			purpose: profile['purpose'],
			kind: profile['kind'],
			schedule: { ...profile['schedule'] } as JsonObject,
			periods,
			...(validFrom === undefined ? {} : { validFrom }),
			...(validTo === undefined ? {} : { validTo }),
			...(transactionId === undefined ? {} : { transactionId }),
			...(receivedAt === undefined ? {} : { receivedAt }),
		};
	});
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
		const pendingAvailability = entry['pendingAvailability'];
		if (
			pendingAvailability !== undefined &&
			pendingAvailability !== 'Operative' &&
			pendingAvailability !== 'Inoperative'
		) {
			throw new SimulatorError(
				'invalid-snapshot',
				`connectors[${index}].pendingAvailability is invalid`,
			);
		}
		return {
			id,
			status: status as ConnectorStatus16,
			errorCode,
			meterWh,
			chargingPowerKw,
			activeTransaction: restoreActiveTransaction16(activeTransaction, index),
			reservation: restoreReservation16(reservation, index),
			...(pendingAvailability === undefined ? {} : { pendingAvailability }),
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
	if (status === 'Unavailable' || status === 'Faulted') {
		cancelReservationTimer16(engine, connector.id);
		connector.reservation = null;
	}
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
	if (engine.state.pendingReboot === true) return { ok: false, reason: 'reboot-pending' };
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
	if (engine.state.pendingReboot === true) return { ok: false, reason: 'reboot-pending' };
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
		cancelReservationTimer16(engine, connector.id);
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

export function stopTransaction(
	engine: EngineBase<Simulator16State>,
	connectorId: number,
	reason = 'Local',
): Promise<void> {
	const connector = engine.state.connectors.find((item) => item.id === connectorId);
	const tx = connector?.activeTransaction;
	if (connector === undefined || tx === null || tx === undefined) return Promise.resolve();
	const existing = stopOperations.get(tx);
	if (existing !== undefined) return existing;
	const previousStatus = connector.status;
	const previousErrorCode = connector.errorCode;
	const rollback = (): void => {
		if (connector.activeTransaction !== tx) return;
		connector.status = previousStatus;
		connector.errorCode = previousErrorCode;
		connector.updatedAt = engine.now();
		try {
			startMeterLoop(engine, connector.id, engine.getMeterValueIntervalMs());
		} catch {
			// The engine may be disposing.
		}
		void sendStatusNotification(engine, connector, previousStatus, previousErrorCode).catch(
			() => undefined,
		);
	};
	const operation = (async () => {
		try {
			await sendStatusNotification(engine, connector, 'Finishing');
			stopMeterLoop(engine, connector.id);
			const stopPayload: JsonObject = {
				transactionId: tx.transactionId,
				meterStop: Math.round(connector.meterWh),
				timestamp: engine.ocppNow(),
				reason,
				idTag: tx.idTag,
			};
			if (engine.isReady) {
				try {
					await engine.sendCall('StopTransaction', stopPayload);
				} catch (error) {
					if (
						error instanceof SimulatorError &&
						(error.code === 'timeout' ||
							error.code === 'send-failed' ||
							error.code === 'disconnected' ||
							error.code === 'not-connected')
					) {
						await engine.queueCall('StopTransaction', stopPayload);
					} else {
						throw error;
					}
				}
			} else {
				await engine.sendOrQueue('StopTransaction', stopPayload);
			}
			engine.state.chargingProfiles = engine.state.chargingProfiles.filter(
				(profile) =>
					!(
						profile.connectorId === connector.id &&
						profile.purpose === 'TxProfile' &&
						(profile.transactionId === undefined || profile.transactionId === tx.transactionId)
					),
			);
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
			const pending = connector.pendingAvailability;
			delete connector.pendingAvailability;
			await sendStatusNotification(
				engine,
				connector,
				pending === 'Inoperative' ? 'Unavailable' : 'Available',
			);
			if (
				engine.state.pendingReboot === true &&
				!engine.state.connectors.some((item) => item.activeTransaction !== null)
			) {
				delete engine.state.pendingReboot;
				engine.reboot();
			}
		} catch (error) {
			rollback();
			throw error;
		}
	})();
	stopOperations.set(tx, operation);
	const cleanup = (): void => {
		if (stopOperations.get(tx) === operation) stopOperations.delete(tx);
	};
	void operation.then(cleanup, cleanup);
	return operation;
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

function parseChargingProfile16(
	connectorId: number,
	payload: JsonObject,
): ChargingProfile16 | undefined {
	const profile = payload['csChargingProfiles'] ?? payload['chargingProfile'];
	if (!isRecord(profile)) return undefined;
	const id = profile['chargingProfileId'];
	const stackLevel = profile['stackLevel'];
	const purpose = profile['chargingProfilePurpose'];
	const kind = profile['chargingProfileKind'];
	const schedule = profile['chargingSchedule'];
	const validFrom = profile['validFrom'];
	const validTo = profile['validTo'];
	const transactionId = profile['transactionId'];
	if (
		!isInteger(id) ||
		!isInteger(stackLevel) ||
		stackLevel < 0 ||
		typeof purpose !== 'string' ||
		typeof kind !== 'string' ||
		!isRecord(schedule) ||
		(validFrom !== undefined &&
			(typeof validFrom !== 'string' || !Number.isFinite(Date.parse(validFrom)))) ||
		(validTo !== undefined &&
			(typeof validTo !== 'string' || !Number.isFinite(Date.parse(validTo)))) ||
		(transactionId !== undefined && !isInteger(transactionId))
	) {
		return undefined;
	}
	const unit = schedule['chargingRateUnit'];
	if (unit !== 'W' && unit !== 'A') return undefined;
	const duration = schedule['duration'];
	if (
		duration !== undefined &&
		(!isFiniteNumber(duration) || !Number.isInteger(duration) || duration <= 0)
	) {
		return undefined;
	}
	const periodEntries = schedule['chargingSchedulePeriod'];
	if (!Array.isArray(periodEntries) || periodEntries.length === 0) {
		return undefined;
	}
	const periods: ChargingProfile16['periods'] = [];
	for (const entry of periodEntries) {
		if (!isRecord(entry)) return undefined;
		const startPeriod = entry['startPeriod'];
		const limit = entry['limit'];
		const numberPhases = entry['numberPhases'];
		if (
			!isFiniteNumber(startPeriod) ||
			startPeriod < 0 ||
			!Number.isInteger(startPeriod) ||
			!isFiniteNumber(limit)
		) {
			return undefined;
		}
		if (
			numberPhases !== undefined &&
			(!isInteger(numberPhases) || numberPhases < 1 || numberPhases > 3)
		) {
			return undefined;
		}
		periods.push({
			startPeriod,
			limit,
			...(numberPhases === undefined ? {} : { numberPhases }),
		});
	}
	periods.sort((left, right) => left.startPeriod - right.startPeriod);
	return {
		connectorId,
		id,
		stackLevel,
		purpose,
		kind,
		schedule: { ...schedule },
		periods,
		...(validFrom === undefined ? {} : { validFrom }),
		...(validTo === undefined ? {} : { validTo }),
		...(transactionId === undefined ? {} : { transactionId }),
	};
}

function buildCompositeSchedule16(
	engine: EngineBase<Simulator16State>,
	connectorId: number,
	duration: number,
	requestedUnit: 'W' | 'A',
): JsonObject {
	const connector = engine.state.connectors.find((item) => item.id === connectorId);
	const now = Date.parse(engine.ocppNow());
	const schedulerNow = engine.now();
	const profiles = engine.state.chargingProfiles.filter(
		(profile) =>
			profile.connectorId === connectorId || (connectorId !== 0 && profile.connectorId === 0),
	);
	const activeTransaction = connector?.activeTransaction ?? null;
	const startOffset = (profile: ChargingProfile16): number => {
		const startSchedule = profile.schedule['startSchedule'];
		if (typeof startSchedule === 'string') {
			const parsed = Date.parse(startSchedule);
			if (Number.isFinite(parsed)) return (parsed - now) / 1000;
		}
		const anchor =
			profile.purpose === 'ChargePointMaxProfile'
				? profile.receivedAt
				: (activeTransaction?.startedAt ?? profile.receivedAt);
		return anchor === undefined ? 0 : (anchor - schedulerNow) / 1000;
	};
	const scheduleDuration = (profile: ChargingProfile16): number => {
		const value = Number(profile.schedule['duration'] ?? duration);
		return Number.isFinite(value) && value > 0 ? value : duration;
	};

	const fallbackWatts = (connector?.chargingPowerKw ?? 0) * 1000 || 32_000;
	const fallback =
		requestedUnit === 'W'
			? Math.round(fallbackWatts)
			: Math.round((fallbackWatts / (230 * 3)) * 10) / 10;

	const boundaries = new Set<number>([0, duration]);
	const addBoundary = (value: number): void => {
		for (const candidate of [Math.floor(value), Math.ceil(value)]) {
			if (candidate > 0 && candidate < duration) boundaries.add(candidate);
		}
	};
	for (const profile of profiles) {
		const rawStart = startOffset(profile);
		const windowEnd = rawStart + scheduleDuration(profile);
		addBoundary(rawStart);
		addBoundary(windowEnd);
		if (profile.validFrom !== undefined) {
			addBoundary((Date.parse(profile.validFrom) - now) / 1000);
		}
		if (profile.validTo !== undefined) {
			addBoundary((Date.parse(profile.validTo) - now) / 1000);
		}
		for (const period of profile.periods) {
			addBoundary(rawStart + period.startPeriod);
		}
	}

	const periodAt = (
		profile: ChargingProfile16,
		start: number,
	): { limitW: number; phases: number } | undefined => {
		const rawStart = startOffset(profile);
		if (start < rawStart || start >= rawStart + scheduleDuration(profile)) return undefined;
		if (profile.validFrom !== undefined && now + start * 1000 < Date.parse(profile.validFrom)) {
			return undefined;
		}
		if (profile.validTo !== undefined && now + start * 1000 >= Date.parse(profile.validTo)) {
			return undefined;
		}
		if (profile.purpose === 'TxProfile') {
			if (activeTransaction === null) return undefined;
			if (
				profile.transactionId !== undefined &&
				profile.transactionId !== activeTransaction.transactionId
			) {
				return undefined;
			}
		}
		const sourceUnit = profile.schedule['chargingRateUnit'] as 'W' | 'A';
		const period = [...profile.periods]
			.reverse()
			.find((item) => rawStart + item.startPeriod <= start);
		if (period === undefined) return undefined;
		const phases = period.numberPhases ?? 3;
		const watts = sourceUnit === 'A' ? period.limit * 230 * phases : period.limit;
		return { limitW: watts, phases };
	};

	const pick = (purpose: string, start: number): ChargingProfile16 | undefined => {
		const candidates = profiles.filter(
			(profile) => profile.purpose === purpose && periodAt(profile, start) !== undefined,
		);
		if (candidates.length === 0) return undefined;
		return candidates.reduce((best, profile) => {
			if (profile.stackLevel !== best.stackLevel) {
				return profile.stackLevel > best.stackLevel ? profile : best;
			}
			const bestSpecific = best.connectorId === connectorId ? 1 : 0;
			const profileSpecific = profile.connectorId === connectorId ? 1 : 0;
			return profileSpecific > bestSpecific ? profile : best;
		});
	};

	const periods: Array<{ startPeriod: number; limit: number; numberPhases?: number }> = [];
	const sortedBoundaries = [...boundaries]
		.filter((value) => value >= 0 && value < duration)
		.sort((a, b) => a - b);
	for (const start of sortedBoundaries) {
		const maxProfile = pick('ChargePointMaxProfile', start);
		const txProfile = pick('TxProfile', start);
		const defaultProfile = txProfile === undefined ? pick('TxDefaultProfile', start) : undefined;
		const selected = [maxProfile, txProfile, defaultProfile].filter(
			(profile): profile is ChargingProfile16 => profile !== undefined,
		);
		let limitW = Number.POSITIVE_INFINITY;
		let phases = 3;
		for (const profile of selected) {
			const active = periodAt(profile, start);
			if (active === undefined) continue;
			if (active.limitW < limitW) {
				limitW = active.limitW;
				phases = active.phases;
			}
		}
		const value = Number.isFinite(limitW) ? limitW : fallbackWatts;
		const limit =
			requestedUnit === 'W' ? Math.round(value) : Math.round((value / (230 * phases)) * 10) / 10;
		const numberPhases = requestedUnit === 'A' ? phases : undefined;
		const previous = periods[periods.length - 1];
		if (
			previous !== undefined &&
			previous.limit === limit &&
			previous.numberPhases === numberPhases
		) {
			continue;
		}
		periods.push({
			startPeriod: start,
			limit,
			...(numberPhases === undefined ? {} : { numberPhases }),
		});
	}
	if (periods.length === 0) {
		periods.push({
			startPeriod: 0,
			limit: fallback,
			...(requestedUnit === 'A' ? { numberPhases: 3 } : {}),
		});
	}
	return {
		duration,
		chargingRateUnit: requestedUnit,
		chargingSchedulePeriod: periods,
	};
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
			if (engine.state.pendingReboot === true) {
				await context.reply({ status: 'Rejected' });
				return;
			}
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
			const value = context.payload['value'];
			if (typeof value !== 'string') {
				await context.reply({ status: 'Rejected' });
				return;
			}
			const result = applyConfiguration16(engine, key, value);
			await context.reply(result);
		},
		Reset: async (context) => {
			const type = stringValue(context.payload['type'], '');
			if (type !== 'Hard' && type !== 'Soft') {
				await context.reply({ status: 'Rejected' });
				return;
			}
			if (engine.state.pendingReboot === true) {
				await context.reply({ status: 'Rejected' });
				return;
			}
			engine.state.pendingReboot = true;
			await context.reply({ status: 'Accepted' });
			const reason = type === 'Soft' ? 'SoftReset' : 'HardReset';
			try {
				for (const connector of engine.state.connectors) {
					if (connector.activeTransaction !== null) {
						await stopTransaction(engine, connector.id, reason);
					}
				}
			} finally {
				if (
					engine.state.pendingReboot === true &&
					!engine.state.connectors.some((item) => item.activeTransaction !== null)
				) {
					delete engine.state.pendingReboot;
					engine.reboot();
				}
			}
		},
		TriggerMessage: async (context) => {
			const requested = stringValue(context.payload['requestedMessage'], '');
			const supported = [
				'BootNotification',
				'DiagnosticsStatusNotification',
				'FirmwareStatusNotification',
				'Heartbeat',
				'MeterValues',
				'StatusNotification',
			];
			if (!supported.includes(requested)) {
				await context.reply({ status: 'NotImplemented' });
				return;
			}
			if (!engine.isReady) {
				await context.reply({ status: 'Rejected' });
				return;
			}
			const rawConnector = context.payload['connectorId'];
			const connectorId = rawConnector === undefined ? undefined : Number(rawConnector);
			if (connectorId !== undefined && (!Number.isInteger(connectorId) || connectorId < 0)) {
				await context.reply({ status: 'Rejected' });
				return;
			}
			const connector =
				connectorId === undefined || connectorId === 0
					? undefined
					: engine.state.connectors.find((item) => item.id === connectorId);
			if (connectorId !== undefined && connectorId > 0 && connector === undefined) {
				await context.reply({ status: 'Rejected' });
				return;
			}
			await context.reply({ status: 'Accepted' });
			switch (requested) {
				case 'BootNotification':
					await engine.bootNotification({ force: true });
					break;
				case 'DiagnosticsStatusNotification':
					await engine.sendOrQueue('DiagnosticsStatusNotification', {
						status: engine.state.diagnosticsStatus ?? 'Idle',
					});
					break;
				case 'FirmwareStatusNotification':
					await engine.sendOrQueue('FirmwareStatusNotification', {
						status: engine.state.firmwareStatus ?? 'Idle',
					});
					break;
				case 'Heartbeat':
					await engine.sendCall('Heartbeat', {});
					break;
				case 'MeterValues': {
					const targets =
						connectorId === undefined
							? engine.state.connectors
							: connector === undefined
								? []
								: [connector];
					if (connectorId === 0) {
						await engine.sendOrQueue('MeterValues', {
							connectorId: 0,
							meterValue: [
								{
									timestamp: engine.ocppNow(),
									sampledValue: [
										{
											value: '0',
											context: 'Trigger',
											format: 'Raw',
											measurand: 'Energy.Active.Import.Register',
											unit: 'Wh',
										},
									],
								},
							],
						});
					}
					for (const target of targets) {
						await sendMeterValues(engine, target.id);
					}
					break;
				}
				case 'StatusNotification':
					if (connectorId === 0) {
						await engine.sendOrQueue('StatusNotification', {
							connectorId: 0,
							errorCode: 'NoError',
							status: 'Available',
							timestamp: engine.ocppNow(),
						});
					} else if (connector === undefined) {
						await sendAllStatusNotifications(engine);
					} else {
						await sendStatusNotification(engine, connector, connector.status, connector.errorCode);
					}
					break;
			}
		},
		GetConfiguration: async (context) => {
			const keys = configurationEntries16(engine, station);
			const requested = Array.isArray(context.payload['key'])
				? (context.payload['key'] as string[])
				: [];
			const selected =
				requested.length === 0 ? keys : keys.filter((item) => requested.includes(item.key));
			const unknownKey = requested.filter((key) => !keys.some((item) => item.key === key));
			await context.reply({
				configurationKey: selected as unknown as JsonObject[],
				unknownKey,
			});
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
			if (targets.length === 0) {
				await context.reply({ status: 'Rejected' });
				return;
			}
			const active = targets.some((item) => item.activeTransaction !== null);
			await context.reply({ status: active ? 'Scheduled' : 'Accepted' });
			for (const connector of targets) {
				if (connector.activeTransaction !== null) {
					connector.pendingAvailability = type;
				} else {
					delete connector.pendingAvailability;
					if (
						status === 'Available' &&
						connector.status === 'Reserved' &&
						connector.reservation !== null
					) {
						continue;
					}
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
			cancelReservationTimer16(engine, connector.id);
			connector.reservation = null;
			if (connector.activeTransaction !== null) {
				await stopTransaction(engine, connector.id, 'Remote');
			} else if (connector.status === 'Reserved') {
				await sendStatusNotification(engine, connector, 'Available');
			}
		},
		ClearCache: async (context) => {
			engine.state.localAuthorizationList = [];
			await context.reply({ status: 'Accepted' });
		},
		GetDiagnostics: async (context) => {
			await context.reply({ fileName: `diagnostics-${station.id}.txt` });
			startDiagnostics16(engine, station);
		},
		UpdateFirmware: async (context) => {
			await context.reply({});
			startFirmwareUpdate16(engine);
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
			const reservationId = Number(context.payload['reservationId'] ?? 0);
			const idTag = stringValue(context.payload['idTag'], '');
			const expiryDate = stringValue(context.payload['expiryDate'], '');
			const expiry = Date.parse(expiryDate);
			if (
				connector === undefined ||
				!Number.isInteger(reservationId) ||
				reservationId <= 0 ||
				idTag === '' ||
				!Number.isFinite(expiry) ||
				expiry <= Date.parse(engine.ocppNow())
			) {
				await context.reply({ status: 'Rejected' });
				return;
			}
			if (connector.status === 'Unavailable') {
				await context.reply({ status: 'Unavailable' });
				return;
			}
			if (connector.status === 'Faulted') {
				await context.reply({ status: 'Faulted' });
				return;
			}
			const replacing = connector.reservation?.id === reservationId;
			if (connector.status !== 'Available' && !(connector.status === 'Reserved' && replacing)) {
				await context.reply({ status: 'Occupied' });
				return;
			}
			const existing = engine.state.connectors.find(
				(item) => item.id !== connector.id && item.reservation?.id === reservationId,
			);
			if (existing !== undefined) {
				cancelReservationTimer16(engine, existing.id);
				existing.reservation = null;
				if (existing.status === 'Reserved') {
					await sendStatusNotification(engine, existing, 'Available');
				}
			}
			cancelReservationTimer16(engine, connector.id);
			connector.reservation = { id: reservationId, expiryDate, idTag };
			armReservationTimer16(engine, connector);
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
			cancelReservationTimer16(engine, connector.id);
			connector.reservation = null;
			await context.reply({ status: 'Accepted' });
			if (connector.status === 'Reserved') {
				await sendStatusNotification(engine, connector, 'Available');
			}
		},
		DataTransfer: async (context) => {
			await context.reply({ status: 'Accepted' });
		},
		SetChargingProfile: async (context) => {
			const connectorId = Number(context.payload['connectorId'] ?? 0);
			if (
				!Number.isInteger(connectorId) ||
				connectorId < 0 ||
				(connectorId > 0 && !engine.state.connectors.some((item) => item.id === connectorId))
			) {
				await context.reply({ status: 'Rejected' });
				return;
			}
			const profile = parseChargingProfile16(connectorId, context.payload);
			if (profile === undefined) {
				await context.reply({ status: 'Rejected' });
				return;
			}
			const raw = context.payload['csChargingProfiles'] ?? context.payload['chargingProfile'];
			if (!isRecord(raw)) {
				await context.reply({ status: 'Rejected' });
				return;
			}
			if (
				(profile.purpose !== 'ChargePointMaxProfile' &&
					profile.purpose !== 'TxDefaultProfile' &&
					profile.purpose !== 'TxProfile') ||
				(profile.kind !== 'Absolute' && profile.kind !== 'Recurring' && profile.kind !== 'Relative')
			) {
				await context.reply({ status: 'Rejected' });
				return;
			}
			if (profile.purpose === 'ChargePointMaxProfile' && connectorId !== 0) {
				await context.reply({ status: 'Rejected' });
				return;
			}
			if (profile.purpose === 'TxProfile') {
				const connector = engine.state.connectors.find((item) => item.id === connectorId);
				if (connector === undefined || connector.activeTransaction === null) {
					await context.reply({ status: 'Rejected' });
					return;
				}
				if (
					profile.transactionId !== undefined &&
					profile.transactionId !== connector.activeTransaction.transactionId
				) {
					await context.reply({ status: 'Rejected' });
					return;
				}
			}
			engine.state.chargingProfiles = engine.state.chargingProfiles.filter(
				(item) =>
					item.id !== profile.id &&
					!(
						item.connectorId === profile.connectorId &&
						item.purpose === profile.purpose &&
						item.stackLevel === profile.stackLevel
					),
			);
			profile.receivedAt = engine.now();
			engine.state.chargingProfiles.push(profile);
			await context.reply({ status: 'Accepted' });
		},
		ClearChargingProfile: async (context) => {
			const id = context.payload['id'];
			const connectorId = context.payload['connectorId'];
			const purpose = context.payload['chargingProfilePurpose'];
			const stackLevel = context.payload['stackLevel'];
			const hasFilters =
				id !== undefined ||
				connectorId !== undefined ||
				purpose !== undefined ||
				stackLevel !== undefined;
			const before = engine.state.chargingProfiles;
			const remaining = before.filter((profile) => {
				if (id !== undefined) return profile.id !== id;
				if (connectorId !== undefined && profile.connectorId !== connectorId) return true;
				if (purpose !== undefined && profile.purpose !== purpose) return true;
				if (stackLevel !== undefined && profile.stackLevel !== stackLevel) return true;
				return false;
			});
			engine.state.chargingProfiles = remaining;
			const removed = before.length - remaining.length;
			await context.reply({
				status: !hasFilters || removed > 0 ? 'Accepted' : 'Unknown',
			});
		},
		GetCompositeSchedule: async (context) => {
			const connectorId = Number(context.payload['connectorId'] ?? 0);
			const duration = Number(context.payload['duration'] ?? 3600);
			const unit = stringValue(context.payload['chargingRateUnit'], 'W');
			if (
				!Number.isInteger(connectorId) ||
				connectorId < 0 ||
				(connectorId > 0 && !engine.state.connectors.some((item) => item.id === connectorId)) ||
				!Number.isFinite(duration) ||
				!Number.isInteger(duration) ||
				duration <= 0 ||
				(unit !== 'W' && unit !== 'A')
			) {
				await context.reply({ status: 'Rejected' });
				return;
			}
			const schedule = buildCompositeSchedule16(engine, connectorId, duration, unit);
			engine.state.compositeSchedules[String(connectorId)] = schedule;
			await context.reply({
				status: 'Accepted',
				connectorId,
				scheduleStart: engine.ocppNow(),
				chargingSchedule: schedule,
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

	override setMeterValueIntervalMs(value: number): void {
		super.setMeterValueIntervalMs(value);
		for (const connector of this.state.connectors) {
			if (connector.activeTransaction !== null) {
				startMeterLoop(this, connector.id, this.getMeterValueIntervalMs());
			}
		}
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
