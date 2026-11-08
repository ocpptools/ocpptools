// SPDX-License-Identifier: Apache-2.0
// SPDX-FileCopyrightText: 2026 Rodolfo Carrillo

import type { JsonObject } from '@ocpptools/core';

import { EngineBase, type EngineProfile } from '../../engine.js';
import { SimulatorError } from '../../errors.js';
import type { CallContext } from '../../rpc.js';
import type { CommonSimulatorOptions } from '../../state.js';
import {
	createChargingHandlers,
	createChargingProfileState201,
	sendClearedChargingLimit201,
	sendNotifyChargingLimit201,
	sendNotifyEVChargingNeeds201,
	sendNotifyEVChargingSchedule201,
	type ChargingProfileState201,
} from './charging.js';
import {
	createServicesHandlers,
	createServicesState201,
	removeTransactionDisplays201,
	sendFirmwareStatus201,
	sendLogStatus201,
	sendNotifyCustomerInformation201,
	sendNotifyDisplayMessages201,
	sendPublishFirmwareStatus201,
	type ServicesState201,
} from './services.js';
import {
	createDeviceModelHandlers,
	createMonitoringState201,
	evaluateMonitors201,
	sendNotifyEvent201,
	type MonitoringState201,
	type NetworkProfile201,
} from './device-model.js';
import {
	createLocalAuthHandlers,
	createLocalAuthorizationState201,
	cancelEvseReservations201,
	localAuthorizationDecision201,
	localGroupToken201,
	rearmReservations201,
	reservationAllows201,
	restoreReservation201,
	sendReservationStatusUpdate201,
	takeReservation201,
	type LocalAuthorizationState201,
	type Reservation201,
} from './local-auth.js';

export type EvseStatus201 = 'Available' | 'Occupied' | 'Reserved' | 'Unavailable' | 'Faulted';
export type ChargingState201 =
	'EVConnected' | 'Charging' | 'SuspendedEV' | 'SuspendedEVSE' | 'Idle';
export type IdTokenKind201 =
	| 'Central'
	| 'eMAID'
	| 'ISO14443'
	| 'ISO15693'
	| 'KeyCode'
	| 'Local'
	| 'MacAddress'
	| 'NoAuthorization';

export interface ActiveTransaction201 {
	transactionId: string;
	idToken: string;
	idTokenType: IdTokenKind201;
	startedAt: number;
	chargingState: ChargingState201;
	seqNo: number;
	meterStartWh: number;
	remoteStartId?: number;
	reservationId?: number;
	/** True while an Ended event is being delivered; blocks a second stop. */
	stopping: boolean;
}

export interface Evse201 {
	id: number;
	connectorId: number;
	status: EvseStatus201;
	operational: 'Operative' | 'Inoperative';
	/** Status restored when the EVSE becomes operative again. */
	statusBeforeInoperative: EvseStatus201 | null;
	meterWh: number;
	/** Power used while a transaction is active. */
	chargingPowerKw: number;
	/** Power restored after the transaction ends. */
	defaultChargingPowerKw: number;
	transaction: ActiveTransaction201 | null;
	/** Availability change that waits for the active transaction to end. */
	pendingOperational: 'Operative' | 'Inoperative' | null;
	/** True while a start is awaiting authorization or delivery. */
	starting: boolean;
	updatedAt: number;
}

export interface CompletedTransaction201 {
	evseId: number;
	transactionId: string;
	idToken: string;
	energyWh: number;
	startedAt: number;
	stoppedAt: number;
	reason: string;
}

export interface PendingResets201 {
	/** A station-wide OnIdle reset waits for every transaction. */
	station: boolean;
	/** Per-EVSE OnIdle resets. */
	evseIds: number[];
}

export interface Simulator201State {
	evses: Evse201[];
	variables: Record<string, string>;
	completedTransactions: CompletedTransaction201[];
	txSeq: number;
	pendingResets: PendingResets201;
	monitoring: MonitoringState201;
	networkProfiles: NetworkProfile201[];
	localAuthorization: LocalAuthorizationState201;
	reservations: Reservation201[];
	charging: ChargingProfileState201;
	services: ServicesState201;
}

export interface Station201Options {
	readonly id: string;
	readonly vendorName: string;
	readonly model: string;
	readonly firmwareVersion: string;
	readonly evseCount?: number;
	readonly defaultIdToken?: string;
	readonly idTokenType?: IdTokenKind201;
	readonly defaultChargingPowerKw?: number;
}

export interface Simulator201Options extends CommonSimulatorOptions {
	readonly station: Station201Options;
}

const meterLoops = new WeakMap<object, Map<number, () => void>>();

export function createSimulator201Profile(
	station: Station201Options,
): EngineProfile<Simulator201State> {
	const evseCount = clampEvses(station.evseCount ?? 1);
	const defaultPower = normalizePower(station.defaultChargingPowerKw ?? 0);

	return {
		version: '2.0.1',
		subprotocol: 'ocpp2.0.1',
		createState: () => ({
			evses: Array.from({ length: evseCount }, (_, index) => ({
				id: index + 1,
				connectorId: 1,
				status: 'Available',
				operational: 'Operative',
				statusBeforeInoperative: null,
				meterWh: 0,
				chargingPowerKw: defaultPower,
				defaultChargingPowerKw: defaultPower,
				transaction: null,
				pendingOperational: null,
				starting: false,
				updatedAt: 0,
			})),
			variables: {
				'OCPPCommCtrlr/HeartbeatInterval': '60',
				'AlignedDataCtrlr/Enabled': 'true',
				'SampledDataCtrlr/TxUpdatedInterval': '30',
				'DeviceDataCtrlr/Enabled': 'true',
			},
			completedTransactions: [],
			txSeq: 0,
			pendingResets: { station: false, evseIds: [] },
			monitoring: createMonitoringState201(),
			networkProfiles: [],
			localAuthorization: createLocalAuthorizationState201(),
			reservations: [],
			charging: createChargingProfileState201(),
			services: createServicesState201(),
		}),
		bootPayload: (reason = 'PowerUp') => ({
			chargingStation: {
				model: station.model,
				vendorName: station.vendorName,
				firmwareVersion: station.firmwareVersion,
			},
			reason,
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
		register: (engine) => {
			registerInbound(engine);
		},
		onReady: async (engine) => {
			await sendAllStatusNotifications(engine);
			rearmReservations201(engine);
			for (const evse of engine.state.evses) {
				if (evse.transaction !== null) {
					startMeterLoop(engine, evse.id, engine.getMeterValueIntervalMs());
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

export async function sendStatusNotification(
	engine: EngineBase<Simulator201State>,
	evse: Evse201,
	status: EvseStatus201 = evse.status,
): Promise<void> {
	if (status === 'Unavailable' || status === 'Faulted') {
		await cancelEvseReservations201(engine, evse.id).catch((error: unknown) =>
			reportProfileError(engine, error),
		);
	}
	evse.status = status;
	evse.updatedAt = engine.now();
	engine.events.emit({
		type: 'evse',
		at: engine.now(),
		evseId: evse.id,
		status,
		meterWh: Math.round(evse.meterWh),
	});
	await engine.sendOrQueue('StatusNotification', {
		timestamp: engine.ocppNow(),
		connectorStatus: status,
		evseId: evse.id,
		connectorId: evse.connectorId,
	});
}

export async function sendAllStatusNotifications(
	engine: EngineBase<Simulator201State>,
): Promise<void> {
	for (const evse of engine.state.evses) {
		await sendStatusNotification(engine, evse, evse.status);
	}
}

/**
 * Applies an operational change. Faulted status survives an Inoperative
 * request and is restored when the EVSE becomes operative again.
 */
export async function applyOperationalState(
	engine: EngineBase<Simulator201State>,
	evse: Evse201,
	operational: 'Operative' | 'Inoperative',
): Promise<void> {
	if (evse.operational === operational) return;
	evse.operational = operational;
	if (operational === 'Inoperative') {
		const canceledReservations = await cancelEvseReservations201(engine, evse.id).catch(
			(error: unknown) => {
				reportProfileError(engine, error);
				return false;
			},
		);
		if (evse.status === 'Faulted') return;
		evse.statusBeforeInoperative =
			evse.status === 'Reserved' && canceledReservations ? 'Available' : evse.status;
		await sendStatusNotification(engine, evse, 'Unavailable');
		return;
	}
	const restored =
		evse.statusBeforeInoperative ?? (evse.status === 'Unavailable' ? 'Available' : evse.status);
	evse.statusBeforeInoperative = null;
	await sendStatusNotification(engine, evse, restored);
}

async function applyPendingOperational(engine: EngineBase<Simulator201State>): Promise<void> {
	for (const evse of engine.state.evses) {
		if (evse.pendingOperational === null || evse.transaction !== null) continue;
		const operational = evse.pendingOperational;
		evse.pendingOperational = null;
		await applyOperationalState(engine, evse, operational);
	}
}

function maybeRunPendingReset(engine: EngineBase<Simulator201State>): void {
	const pending = engine.state.pendingResets;
	if (pending.station) {
		if (engine.state.evses.some((evse) => evse.transaction !== null)) return;
		pending.station = false;
		pending.evseIds = [];
		emitResetNotice(engine);
		return;
	}
	for (const evseId of [...pending.evseIds]) {
		const evse = engine.state.evses.find((item) => item.id === evseId);
		if (evse !== undefined && evse.transaction !== null) continue;
		pending.evseIds = pending.evseIds.filter((id) => id !== evseId);
		emitResetNotice(engine);
	}
}

function addPendingReset(engine: EngineBase<Simulator201State>, evseId?: number): void {
	const pending = engine.state.pendingResets;
	if (evseId === undefined) {
		pending.station = true;
		pending.evseIds = [];
		return;
	}
	if (pending.station || pending.evseIds.includes(evseId)) return;
	pending.evseIds.push(evseId);
}

function clearPendingReset(engine: EngineBase<Simulator201State>, evseId?: number): void {
	const pending = engine.state.pendingResets;
	if (evseId === undefined) {
		pending.station = false;
		pending.evseIds = [];
		return;
	}
	pending.evseIds = pending.evseIds.filter((id) => id !== evseId);
}

function emitResetNotice(engine: EngineBase<Simulator201State>): void {
	engine.events.emit({
		type: 'notice',
		at: engine.now(),
		level: 'info',
		message: 'Scheduled reset executed',
		code: 'scheduled-reset',
	});
}

function reportProfileError(engine: EngineBase<Simulator201State>, error: unknown): void {
	engine.events.emit({
		type: 'error',
		at: engine.now(),
		error: {
			name: 'SimulatorError',
			code: error instanceof SimulatorError ? error.code : 'internal-error',
			message: error instanceof Error ? error.message : 'Simulator profile failed',
		},
		fatal: false,
	});
}

export interface AuthorizeResult201 {
	readonly accepted: boolean;
	readonly groupIdToken?: string;
}

export async function authorizeWithGroup201(
	engine: EngineBase<Simulator201State>,
	idToken: string,
	idTokenType: IdTokenKind201 = 'ISO14443',
	evseId?: number,
): Promise<AuthorizeResult201> {
	const local = localAuthorizationDecision201(engine, idToken, evseId);
	if (local === 'accepted') {
		const groupIdToken = localGroupToken201(engine, idToken);
		return {
			accepted: true,
			...(groupIdToken === undefined ? {} : { groupIdToken }),
		};
	}
	if (local === 'rejected') return { accepted: false };
	const response = await engine.sendCall('Authorize', {
		idToken: { idToken, type: idTokenType },
	});
	const info = objectValue(response['idTokenInfo']);
	const group = objectValue(info?.['groupIdToken']);
	const groupIdToken = stringValue(group?.['idToken'], '');
	return {
		accepted: info?.['status'] === 'Accepted',
		...(groupIdToken === '' ? {} : { groupIdToken }),
	};
}

export async function authorize201(
	engine: EngineBase<Simulator201State>,
	idToken: string,
	idTokenType: IdTokenKind201 = 'ISO14443',
	evseId?: number,
): Promise<boolean> {
	return (await authorizeWithGroup201(engine, idToken, idTokenType, evseId)).accepted;
}

export function createTransaction201(
	engine: EngineBase<Simulator201State>,
	evse: Evse201,
	options: {
		idToken: string;
		idTokenType?: IdTokenKind201;
		remoteStartId?: number;
		reservationId?: number;
	},
): ActiveTransaction201 {
	engine.state.txSeq += 1;
	return {
		transactionId: `T-${engine.now()}-${engine.state.txSeq}`,
		idToken: options.idToken,
		idTokenType: options.idTokenType ?? 'ISO14443',
		startedAt: engine.now(),
		chargingState: 'EVConnected',
		seqNo: 0,
		meterStartWh: evse.meterWh,
		...(options.remoteStartId === undefined ? {} : { remoteStartId: options.remoteStartId }),
		...(options.reservationId === undefined ? {} : { reservationId: options.reservationId }),
		stopping: false,
	};
}

export async function beginTransaction201(
	engine: EngineBase<Simulator201State>,
	evse: Evse201,
	transaction: ActiveTransaction201,
	triggerReason = 'Authorized',
): Promise<void> {
	evse.transaction = transaction;
	let startedDelivered = false;
	try {
		await sendStatusNotification(engine, evse, 'Occupied');
		await sendTransactionEvent(engine, evse, transaction, 'Started', triggerReason, {
			includeIdToken: true,
		});
		startedDelivered = true;
		transaction.chargingState = 'Charging';
		if (evse.chargingPowerKw <= 0) {
			evse.chargingPowerKw = evse.defaultChargingPowerKw;
		}
		await sendTransactionEvent(engine, evse, transaction, 'Updated', 'ChargingStateChanged', {
			includeMeter: true,
		});
		startMeterLoop(engine, evse.id, engine.getMeterValueIntervalMs());
	} catch (error) {
		stopMeterLoop(engine, evse.id);
		if (startedDelivered) {
			transaction.chargingState = 'Idle';
			try {
				await sendTransactionEvent(engine, evse, transaction, 'Ended', 'StopAuthorized', {
					stoppedReason: 'Other',
					includeMeter: true,
				});
			} catch {
				// The CSMS saw Started. Keep the transaction so a later stop can
				// retry the Ended event instead of leaving an orphan.
				transaction.chargingState = 'Charging';
				startMeterLoop(engine, evse.id, engine.getMeterValueIntervalMs());
				throw error;
			}
		}
		evse.transaction = null;
		await sendStatusNotification(engine, evse, 'Available').catch(() => undefined);
		try {
			await applyPendingOperational(engine);
		} catch (cleanupError) {
			reportProfileError(engine, cleanupError);
		}
		maybeRunPendingReset(engine);
		throw error;
	}
}

export async function startTransaction201(
	engine: EngineBase<Simulator201State>,
	evse: Evse201,
	options: {
		idToken: string;
		idTokenType?: IdTokenKind201;
		remoteStartId?: number;
		reservationId?: number;
		triggerReason?: string;
	},
): Promise<ActiveTransaction201> {
	const transaction = createTransaction201(engine, evse, options);
	await beginTransaction201(engine, evse, transaction, options.triggerReason ?? 'Authorized');
	return transaction;
}

export async function sendTransactionEvent(
	engine: EngineBase<Simulator201State>,
	evse: Evse201,
	transaction: ActiveTransaction201,
	eventType: 'Started' | 'Updated' | 'Ended',
	triggerReason: string,
	options: {
		stoppedReason?: string;
		includeIdToken?: boolean;
		includeMeter?: boolean;
		intervalMs?: number;
	} = {},
): Promise<void> {
	const transactionInfo: JsonObject = {
		transactionId: transaction.transactionId,
		chargingState: transaction.chargingState,
	};
	if (transaction.remoteStartId !== undefined) {
		transactionInfo['remoteStartId'] = transaction.remoteStartId;
	}
	if (options.stoppedReason !== undefined) {
		transactionInfo['stoppedReason'] = options.stoppedReason;
	}
	const payload: JsonObject = {
		eventType,
		timestamp: engine.ocppNow(),
		triggerReason,
		seqNo: transaction.seqNo,
		transactionInfo,
		offline: !engine.isReady,
		evse: { id: evse.id, connectorId: evse.connectorId },
	};
	if (options.includeIdToken === true) {
		payload['idToken'] = { idToken: transaction.idToken, type: transaction.idTokenType };
	}
	if (transaction.reservationId !== undefined && eventType === 'Started') {
		payload['reservationId'] = transaction.reservationId;
	}
	if (options.includeMeter === true) {
		payload['meterValue'] = [
			buildMeterValue(
				engine,
				evse,
				options.intervalMs ?? engine.getMeterValueIntervalMs(),
				eventType === 'Updated',
			),
		];
	}
	await engine.sendOrQueue('TransactionEvent', payload);
	// Advance only after the event is sent or queued, so a failed send can be
	// retried with the same sequence number.
	transaction.seqNo += 1;
	if (eventType === 'Started') {
		transaction.reservationId = undefined;
	}
}

export async function stopTransaction201(
	engine: EngineBase<Simulator201State>,
	evseId: number,
	stoppedReason = 'Local',
	triggerReason = 'StopAuthorized',
): Promise<boolean> {
	const evse = engine.state.evses.find((item) => item.id === evseId);
	const transaction = evse?.transaction;
	if (
		evse === undefined ||
		transaction === null ||
		transaction === undefined ||
		transaction.stopping
	) {
		return false;
	}
	transaction.stopping = true;
	stopMeterLoop(engine, evse.id);
	const previousState = transaction.chargingState;
	transaction.chargingState = 'Idle';
	const pendingOperational = evse.pendingOperational;
	let endedDelivered = false;
	try {
		await sendTransactionEvent(engine, evse, transaction, 'Ended', triggerReason, {
			stoppedReason,
			includeMeter: true,
		});
		endedDelivered = true;
		engine.state.completedTransactions.push({
			evseId: evse.id,
			transactionId: transaction.transactionId,
			idToken: transaction.idToken,
			energyWh: Math.round(evse.meterWh - transaction.meterStartWh),
			startedAt: transaction.startedAt,
			stoppedAt: engine.now(),
			reason: stoppedReason,
		});
		engine.events.emit({
			type: 'transaction',
			at: engine.now(),
			phase: 'stopped',
			protocol: '2.0.1',
			entityId: evse.id,
			transactionId: transaction.transactionId,
		});
		evse.transaction = null;
		removeTransactionDisplays201(engine, transaction.transactionId);
		engine.state.charging.profiles = engine.state.charging.profiles.filter(
			(item) =>
				!(item.evseId === evse.id && item.profile['chargingProfilePurpose'] === 'TxProfile'),
		);
		evse.chargingPowerKw = evse.defaultChargingPowerKw;
		if (pendingOperational === 'Inoperative') {
			// The transaction is over: the state to restore later is Available,
			// not the Occupied status it had while charging.
			evse.status = 'Available';
			evse.statusBeforeInoperative = null;
		}
		try {
			if (pendingOperational === null) {
				await sendStatusNotification(engine, evse, 'Available');
			}
			await applyPendingOperational(engine);
		} catch (cleanupError) {
			// Ended was delivered; a failed status fan-out must not roll back the
			// transaction or suppress the state transitions below.
			reportProfileError(engine, cleanupError);
		}
		maybeRunPendingReset(engine);
		return true;
	} catch (error) {
		if (endedDelivered) {
			return true;
		}
		transaction.chargingState = previousState;
		transaction.stopping = false;
		evse.chargingPowerKw = evse.defaultChargingPowerKw;
		startMeterLoop(engine, evse.id, engine.getMeterValueIntervalMs());
		throw error;
	}
}

export async function startChargingSession201(
	engine: EngineBase<Simulator201State>,
	evseId: number,
	idToken: string,
	idTokenType: IdTokenKind201 = 'ISO14443',
): Promise<{ ok: boolean; transactionId?: string; reason?: string }> {
	const evse = engine.state.evses.find((item) => item.id === evseId);
	if (evse === undefined) return { ok: false, reason: 'invalid-evse' };
	if (evse.transaction !== null || evse.starting) return { ok: false, reason: 'occupied' };
	if (evse.status !== 'Available' && evse.status !== 'Reserved') {
		return { ok: false, reason: 'not-available' };
	}
	evse.starting = true;
	let reservation: Reservation201 | undefined;
	let transaction: ActiveTransaction201 | undefined;
	try {
		const authorization = await authorizeWithGroup201(engine, idToken, idTokenType, evse.id);
		if (!authorization.accepted) {
			return { ok: false, reason: 'authorize-rejected' };
		}
		const groupIdToken = authorization.groupIdToken ?? localGroupToken201(engine, idToken);
		if (!reservationAllows201(engine, evse.id, idToken, groupIdToken)) {
			return { ok: false, reason: 'reserved' };
		}
		reservation = takeReservation201(engine, evse.id, idToken, groupIdToken);
		if (evse.operational !== 'Operative' || !startableStatus(evse)) {
			if (reservation !== undefined) await restoreReservation201(engine, reservation);
			return { ok: false, reason: 'not-available' };
		}
		transaction = createTransaction201(engine, evse, {
			idToken,
			idTokenType,
			...(reservation === undefined ? {} : { reservationId: reservation.id }),
		});
		await beginTransaction201(engine, evse, transaction, 'Authorized');
		return { ok: true, transactionId: transaction.transactionId };
	} catch (error) {
		if (reservation !== undefined && (transaction === undefined || transaction.seqNo === 0)) {
			await restoreReservation201(engine, reservation);
		}
		throw error;
	} finally {
		evse.starting = false;
		await applyPendingOperational(engine);
	}
}

export async function sendMeterValues201(
	engine: EngineBase<Simulator201State>,
	evseId: number,
): Promise<void> {
	const evse = engine.state.evses.find((item) => item.id === evseId);
	if (evse === undefined) {
		throw new SimulatorError('invalid-options', 'Unknown EVSE');
	}
	await engine.sendOrQueue('MeterValues', {
		evseId: evse.id,
		meterValue: [
			buildMeterValue(engine, evse, engine.getMeterValueIntervalMs(), evse.transaction !== null),
		],
	});
}

export function startMeterLoop(
	engine: EngineBase<Simulator201State>,
	evseId: number,
	intervalMs: number,
): void {
	stopMeterLoop(engine, evseId);
	if (!Number.isFinite(intervalMs) || intervalMs <= 0) return;
	let loops = meterLoops.get(engine);
	if (loops === undefined) {
		loops = new Map();
		meterLoops.set(engine, loops);
	}
	const cancel = engine.scheduler.setInterval(async () => {
		if (!engine.isReady) return;
		const evse = engine.state.evses.find((item) => item.id === evseId);
		const transaction = evse?.transaction;
		if (evse === undefined || transaction === null || transaction === undefined) return;
		await sendTransactionEvent(engine, evse, transaction, 'Updated', 'MeterValuePeriodic', {
			includeMeter: true,
			intervalMs,
		});
	}, intervalMs);
	loops.set(evseId, cancel);
}

export function stopMeterLoop(engine: EngineBase<Simulator201State>, evseId: number): void {
	const loops = meterLoops.get(engine);
	const cancel = loops?.get(evseId);
	cancel?.();
	loops?.delete(evseId);
}

function buildMeterValue(
	engine: EngineBase<Simulator201State>,
	evse: Evse201,
	intervalMs: number,
	increment: boolean,
): JsonObject {
	if (increment && evse.chargingPowerKw > 0) {
		evse.meterWh += evse.chargingPowerKw * 1000 * (intervalMs / 3_600_000);
	}
	return {
		timestamp: engine.ocppNow(),
		sampledValue: [
			{
				value: Math.round(evse.meterWh),
				measurand: 'Energy.Active.Import.Register',
				unitOfMeasure: { unit: 'Wh' },
			},
		],
	};
}

function registerInbound(engine: EngineBase<Simulator201State>): void {
	const rejectable: Record<string, JsonObject> = {
		RequestStartTransaction: { status: 'Rejected' },
		RequestStopTransaction: { status: 'Rejected' },
		Reset: { status: 'Rejected' },
		TriggerMessage: { status: 'Rejected' },
		ChangeAvailability: { status: 'Rejected' },
		UnlockConnector: { status: 'UnlockFailed' },
		ClearCache: { status: 'Rejected' },
		DataTransfer: { status: 'Rejected' },
		GetBaseReport: { status: 'Rejected' },
		SetMonitoringBase: { status: 'Rejected' },
		SetMonitoringLevel: { status: 'Rejected' },
		GetMonitoringReport: { status: 'Rejected' },
		GetReport: { status: 'Rejected' },
		SetNetworkProfile: { status: 'Rejected' },
		SendLocalList: { status: 'Rejected' },
		ReserveNow: { status: 'Rejected' },
		CancelReservation: { status: 'Rejected' },
		SetChargingProfile: { status: 'Rejected' },
		ClearChargingProfile: { status: 'Unknown' },
		GetChargingProfiles: { status: 'NoProfiles' },
		GetCompositeSchedule: { status: 'Rejected' },
		SetDisplayMessage: { status: 'Rejected' },
		ClearDisplayMessage: { status: 'Unknown' },
		GetDisplayMessages: { status: 'Unknown' },
		CustomerInformation: { status: 'Rejected' },
		UpdateFirmware: { status: 'Rejected' },
		PublishFirmware: { status: 'Rejected' },
		UnpublishFirmware: { status: 'NoFirmware' },
		GetLog: { status: 'Rejected' },
	};
	const handlers: Record<string, (context: CallContext) => void | Promise<void>> = {
		RequestStartTransaction: async (context) => {
			const evseId = integerValue(context.payload['evseId']) ?? 1;
			const remoteStartId = integerValue(context.payload['remoteStartId']);
			const token = objectValue(context.payload['idToken']);
			const idToken = token === undefined ? undefined : stringValue(token['idToken'], '');
			const type = token === undefined ? 'ISO14443' : idTokenKind(token['type']);
			const rawGroupIdToken = context.payload['groupIdToken'];
			const groupToken = rawGroupIdToken === undefined ? undefined : objectValue(rawGroupIdToken);
			const groupIdToken =
				groupToken === undefined ? undefined : stringValue(groupToken['idToken'], '');
			if (rawGroupIdToken !== undefined && (groupToken === undefined || groupIdToken === '')) {
				await context.reply({ status: 'Rejected' });
				return;
			}
			const evse = engine.state.evses.find((item) => item.id === evseId);
			if (
				evse === undefined ||
				remoteStartId === undefined ||
				idToken === undefined ||
				idToken === '' ||
				evse.transaction !== null ||
				evse.starting ||
				(evse.status !== 'Available' && evse.status !== 'Reserved')
			) {
				await context.reply({ status: 'Rejected' });
				return;
			}
			evse.starting = true;
			let reservation: Reservation201 | undefined;
			try {
				const effectiveGroupIdToken = groupIdToken ?? localGroupToken201(engine, idToken);
				if (!reservationAllows201(engine, evse.id, idToken, effectiveGroupIdToken)) {
					await context.reply({ status: 'Rejected' });
					return;
				}
				reservation = takeReservation201(engine, evse.id, idToken, effectiveGroupIdToken);
				if (evse.operational !== 'Operative' || !startableStatus(evse)) {
					if (reservation !== undefined) await restoreReservation201(engine, reservation);
					await context.reply({ status: 'Rejected' });
					return;
				}
				const transaction = createTransaction201(engine, evse, {
					idToken,
					idTokenType: type,
					remoteStartId,
					...(reservation === undefined ? {} : { reservationId: reservation.id }),
				});
				await context.reply({ status: 'Accepted', transactionId: transaction.transactionId });
				if (evse.operational !== 'Operative' || !startableStatus(evse)) {
					if (reservation !== undefined) await restoreReservation201(engine, reservation);
					return;
				}
				try {
					await beginTransaction201(engine, evse, transaction, 'RemoteStart');
				} catch (error) {
					if (reservation !== undefined && transaction.seqNo === 0) {
						await restoreReservation201(engine, reservation);
					}
					throw error;
				}
			} finally {
				evse.starting = false;
				await applyPendingOperational(engine);
			}
		},
		RequestStopTransaction: async (context) => {
			const transactionId = stringValue(context.payload['transactionId'], '');
			const evse = engine.state.evses.find(
				(item) =>
					item.transaction?.transactionId === transactionId && item.transaction.stopping !== true,
			);
			if (evse === undefined || transactionId === '') {
				await context.reply({ status: 'Rejected' });
				return;
			}
			await context.reply({ status: 'Accepted' });
			await stopTransaction201(engine, evse.id, 'Remote', 'RemoteStop');
		},
		Reset: async (context) => {
			const type = stringValue(context.payload['type'], '');
			if (type !== 'Immediate' && type !== 'OnIdle') {
				await context.reply({ status: 'Rejected' });
				return;
			}
			const evseId = integerValue(context.payload['evseId']);
			const targets =
				evseId === undefined
					? engine.state.evses
					: engine.state.evses.filter((item) => item.id === evseId);
			if (targets.length === 0) {
				await context.reply({ status: 'Rejected' });
				return;
			}
			const active = targets.some(
				(item) => item.transaction !== null && !item.transaction.stopping,
			);
			if (type === 'OnIdle' && active) {
				addPendingReset(engine, evseId);
				await context.reply({ status: 'Scheduled' });
				return;
			}
			clearPendingReset(engine, evseId);
			await context.reply({ status: 'Accepted' });
			if (type === 'OnIdle') {
				emitResetNotice(engine);
				return;
			}
			for (const evse of targets) {
				await stopTransaction201(engine, evse.id, 'ImmediateReset', 'ResetCommand');
			}
		},
		TriggerMessage: async (context) => {
			const requested = stringValue(context.payload['requestedMessage'], '');
			const supported = ['BootNotification', 'Heartbeat', 'StatusNotification', 'TransactionEvent'];
			if (!supported.includes(requested)) {
				await context.reply({ status: 'NotImplemented' });
				return;
			}
			if (requested === 'BootNotification') {
				if (engine.getState().boot.status === 'accepted') {
					await context.reply({ status: 'Rejected' });
					return;
				}
				await context.reply({ status: 'Accepted' });
				await engine.bootNotification({ force: true, reason: 'Triggered' });
				return;
			}
			if (requested === 'TransactionEvent') {
				const evseRef = objectValue(context.payload['evse']);
				const evseId = evseRef === undefined ? undefined : integerValue(evseRef['id']);
				const active = engine.state.evses.filter(
					(item) =>
						item.transaction !== null &&
						!item.transaction.stopping &&
						(evseId === undefined || item.id === evseId),
				);
				if (active.length === 0) {
					await context.reply({ status: 'Rejected' });
					return;
				}
				await context.reply({ status: 'Accepted' });
				for (const evse of active) {
					if (evse.transaction === null) continue;
					await sendTransactionEvent(engine, evse, evse.transaction, 'Updated', 'Trigger', {
						includeMeter: true,
					});
				}
				return;
			}
			await context.reply({ status: 'Accepted' });
			if (requested === 'Heartbeat') await engine.sendCall('Heartbeat', {});
			if (requested === 'StatusNotification') await sendAllStatusNotifications(engine);
		},
		ChangeAvailability: async (context) => {
			const operational = stringValue(context.payload['operationalStatus'], '');
			if (operational !== 'Operative' && operational !== 'Inoperative') {
				await context.reply({ status: 'Rejected' });
				return;
			}
			const evseRef = objectValue(context.payload['evse']);
			const evseId = evseRef === undefined ? undefined : integerValue(evseRef['id']);
			const connectorId = evseRef === undefined ? undefined : integerValue(evseRef['connectorId']);
			const targets =
				evseId === undefined
					? engine.state.evses
					: engine.state.evses.filter((item) => item.id === evseId);
			if (targets.length === 0 || (connectorId !== undefined && connectorId !== 1)) {
				await context.reply({ status: 'Rejected' });
				return;
			}
			const changes = targets.filter((item) => item.operational !== operational);
			if (changes.length === 0) {
				for (const evse of targets) evse.pendingOperational = null;
				await context.reply({ status: 'Accepted' });
				return;
			}
			const active = targets.some((item) => item.transaction !== null || item.starting);
			await context.reply({
				status: active ? 'Scheduled' : 'Accepted',
			});
			for (const evse of targets) {
				evse.pendingOperational = evse.operational === operational ? null : operational;
			}
			if (!active) await applyPendingOperational(engine);
		},
		UnlockConnector: async (context) => {
			const evseId = integerValue(context.payload['evseId']);
			const connectorId = integerValue(context.payload['connectorId']);
			const evse = engine.state.evses.find((item) => item.id === evseId);
			if (evse === undefined || connectorId === undefined || connectorId !== evse.connectorId) {
				await context.reply({ status: 'UnknownConnector' });
				return;
			}
			if (evse.transaction !== null) {
				await context.reply({ status: 'OngoingAuthorizedTransaction' });
				return;
			}
			await context.reply({ status: 'Unlocked' });
		},
		ClearCache: async (context) => {
			await context.reply({ status: 'Accepted' });
		},
		GetVariables: async (context) => {
			const items = strictArray(context.payload['getVariableData']);
			if (items === undefined) {
				await context.fail('FormatViolation', 'getVariableData must be a non-empty array');
				return;
			}
			if (!items.every(validAttributeType)) {
				await context.fail('FormatViolation', 'attributeType is not a 2.0.1 enum value');
				return;
			}
			await context.reply({
				getVariableResult: items.map((item) => getVariableResult(engine, item)),
			});
		},
		SetVariables: async (context) => {
			const items = strictArray(context.payload['setVariableData']);
			if (items === undefined) {
				await context.fail('FormatViolation', 'setVariableData must be a non-empty array');
				return;
			}
			if (!items.every(validAttributeType)) {
				await context.fail('FormatViolation', 'attributeType is not a 2.0.1 enum value');
				return;
			}
			const events: JsonObject[] = [];
			const results = items.map((item) => setVariableResult(engine, item, events));
			await context.reply({ setVariableResult: results });
			for (const event of events) {
				await sendNotifyEvent201(engine, event).catch((error: unknown) =>
					reportProfileError(engine, error),
				);
			}
		},
		GetBaseReport: async (context) => {
			const requestId = integerValue(context.payload['requestId']);
			const reportBase = stringValue(context.payload['reportBase'], '');
			if (requestId === undefined) {
				await context.reply({ status: 'Rejected' });
				return;
			}
			if (
				reportBase !== 'ConfigurationInventory' &&
				reportBase !== 'FullInventory' &&
				reportBase !== 'SummaryInventory'
			) {
				await context.reply({ status: 'NotSupported' });
				return;
			}
			const reportData = buildReportData(engine, reportBase);
			if (reportData.length === 0) {
				await context.reply({ status: 'EmptyResultSet' });
				return;
			}
			await context.reply({ status: 'Accepted' });
			// The CSMS may ask for a report before boot is accepted. Queue it so
			// the report is delivered once the station becomes ready.
			await engine.sendOrQueue('NotifyReport', {
				requestId,
				generatedAt: engine.ocppNow(),
				seqNo: 0,
				tbc: false,
				reportData,
			});
		},
		GetTransactionStatus: async (context) => {
			const transactionId = stringValue(context.payload['transactionId'], '');
			const queued = engine
				.getQueue()
				.filter(
					(entry) =>
						entry.action === 'TransactionEvent' &&
						(transactionId === '' ||
							objectValue(entry.payload['transactionInfo'])?.['transactionId'] === transactionId),
				);
			const response: JsonObject = { messagesInQueue: queued.length > 0 };
			if (transactionId !== '') {
				response['ongoingIndicator'] = engine.state.evses.some(
					(item) => item.transaction?.transactionId === transactionId,
				);
			}
			await context.reply(response);
		},
		DataTransfer: async (context) => {
			if (stringValue(context.payload['vendorId'], '') === '') {
				await context.fail('FormatViolation', 'vendorId is required');
				return;
			}
			await context.reply({ status: 'UnknownVendorId' });
		},
	};

	Object.assign(handlers, createDeviceModelHandlers(engine));
	Object.assign(handlers, createLocalAuthHandlers(engine));
	Object.assign(handlers, createChargingHandlers(engine));
	Object.assign(handlers, createServicesHandlers(engine));

	for (const [action, handler] of Object.entries(handlers)) {
		engine.onCall(action, async (context) => {
			const rejected = rejectable[action];
			if (engine.getInboundResponseMode() === 'reject' && rejected !== undefined) {
				await context.reply(rejected);
				return;
			}
			await handler(context);
		});
	}
}

function getVariableResult(
	engine: EngineBase<Simulator201State>,
	item: Record<string, unknown>,
): JsonObject {
	const component = componentRef(item['component']);
	const variable = variableRef(item['variable']);
	const attributeType = stringValue(item['attributeType'], 'Actual');
	const result: JsonObject = {
		attributeStatus: 'UnknownVariable',
		component,
		variable,
		attributeType,
	};
	if (attributeType !== 'Actual') {
		result['attributeStatus'] = 'NotSupportedAttributeType';
		return result;
	}
	if (!knownComponent(engine, component)) {
		result['attributeStatus'] = 'UnknownComponent';
		return result;
	}
	const value = engine.state.variables[variableKey(component, variable)];
	if (value === undefined) return result;
	result['attributeStatus'] = 'Accepted';
	result['attributeValue'] = value;
	return result;
}

function setVariableResult(
	engine: EngineBase<Simulator201State>,
	item: Record<string, unknown>,
	events: JsonObject[],
): JsonObject {
	const component = componentRef(item['component']);
	const variable = variableRef(item['variable']);
	const attributeType = stringValue(item['attributeType'], 'Actual');
	const value = item['attributeValue'];
	const result: JsonObject = {
		attributeStatus: 'UnknownVariable',
		component,
		variable,
		attributeType,
	};
	if (attributeType !== 'Actual') {
		result['attributeStatus'] = 'NotSupportedAttributeType';
		return result;
	}
	if (!knownComponent(engine, component)) {
		result['attributeStatus'] = 'UnknownComponent';
		return result;
	}
	if (typeof value !== 'string') {
		result['attributeStatus'] = 'Rejected';
		return result;
	}
	const key = variableKey(component, variable);
	const current = engine.state.variables[key];
	if (current === undefined) return result;
	if (key === 'OCPPCommCtrlr/HeartbeatInterval') {
		const seconds = Number(value);
		if (!Number.isInteger(seconds) || seconds <= 0) {
			result['attributeStatus'] = 'Rejected';
			return result;
		}
	}
	if (key === 'SampledDataCtrlr/TxUpdatedInterval') {
		const seconds = Number(value);
		if (!Number.isInteger(seconds) || seconds <= 0) {
			result['attributeStatus'] = 'Rejected';
			return result;
		}
	}
	if ((current === 'true' || current === 'false') && value !== 'true' && value !== 'false') {
		result['attributeStatus'] = 'Rejected';
		return result;
	}
	engine.state.variables[key] = value;
	result['attributeStatus'] = 'Accepted';
	events.push(
		...evaluateMonitors201(
			engine,
			stringValue(component['name'], ''),
			stringValue(variable['name'], ''),
			current,
			value,
		),
	);
	if (key === 'OCPPCommCtrlr/HeartbeatInterval') {
		engine.setHeartbeatIntervalMs(Number(value) * 1000);
	}
	if (key === 'SampledDataCtrlr/TxUpdatedInterval') {
		engine.setMeterValueIntervalMs(Number(value) * 1000);
		for (const evse of engine.state.evses) {
			if (evse.transaction !== null) {
				startMeterLoop(engine, evse.id, engine.getMeterValueIntervalMs());
			}
		}
	}
	return result;
}

function buildReportData(engine: EngineBase<Simulator201State>, reportBase: string): JsonObject[] {
	return Object.entries(engine.state.variables).map(([key, value]) => {
		const split = key.indexOf('/');
		const component = split < 0 ? key : key.slice(0, split);
		const variable = split < 0 ? key : key.slice(split + 1);
		const entry: JsonObject = {
			component: { name: component },
			variable: { name: variable },
			variableAttribute: [{ type: 'Actual', value, mutability: 'ReadWrite' }],
		};
		if (reportBase !== 'SummaryInventory') {
			const boolean = value === 'true' || value === 'false';
			entry['variableCharacteristics'] = {
				dataType: boolean ? 'boolean' : 'string',
				supportsMonitoring: !boolean && Number.isFinite(Number(value)),
			};
		}
		return entry;
	});
}

function componentRef(value: unknown): JsonObject {
	const source = objectValue(value);
	const result: JsonObject = { name: stringValue(source?.['name'], '') };
	if (typeof source?.['instance'] === 'string') result['instance'] = source['instance'];
	const evse = objectValue(source?.['evse']);
	if (evse !== undefined) {
		const id = integerValue(evse['id']);
		if (id !== undefined) {
			const reference: JsonObject = { id };
			const connectorId = integerValue(evse['connectorId']);
			if (connectorId !== undefined) reference['connectorId'] = connectorId;
			result['evse'] = reference;
		}
	}
	return result;
}

function variableRef(value: unknown): JsonObject {
	const source = objectValue(value);
	const result: JsonObject = { name: stringValue(source?.['name'], '') };
	if (typeof source?.['instance'] === 'string') result['instance'] = source['instance'];
	return result;
}

function variableKey(component: JsonObject, variable: JsonObject): string {
	return `${stringValue(component['name'], '')}/${stringValue(variable['name'], '')}`;
}

function knownComponent(engine: EngineBase<Simulator201State>, component: JsonObject): boolean {
	const name = stringValue(component['name'], '');
	return Object.keys(engine.state.variables).some((key) => key.startsWith(`${name}/`));
}

function idTokenKind(value: unknown): IdTokenKind201 {
	const kinds: IdTokenKind201[] = [
		'Central',
		'eMAID',
		'ISO14443',
		'ISO15693',
		'KeyCode',
		'Local',
		'MacAddress',
		'NoAuthorization',
	];
	return kinds.find((kind) => kind === value) ?? 'ISO14443';
}

function strictArray(value: unknown): Record<string, unknown>[] | undefined {
	if (!Array.isArray(value) || value.length === 0) return undefined;
	const items: Record<string, unknown>[] = [];
	for (const entry of value) {
		const object = objectValue(entry);
		if (object === undefined) return undefined;
		items.push(object);
	}
	return items;
}

function validAttributeType(item: Record<string, unknown>): boolean {
	const value = item['attributeType'];
	return (
		value === undefined ||
		value === 'Actual' ||
		value === 'Target' ||
		value === 'MinSet' ||
		value === 'MaxSet'
	);
}

function objectValue(value: unknown): Record<string, unknown> | undefined {
	return typeof value === 'object' && value !== null && !Array.isArray(value)
		? (value as Record<string, unknown>)
		: undefined;
}

function integerValue(value: unknown): number | undefined {
	return typeof value === 'number' && Number.isInteger(value) ? value : undefined;
}

function stringValue(value: unknown, fallback: string): string {
	return typeof value === 'string' ? value : fallback;
}

function startableStatus(evse: Evse201): boolean {
	return evse.status === 'Available' || evse.status === 'Reserved';
}

function clampEvses(value: number): number {
	if (!Number.isFinite(value)) return 1;
	return Math.max(1, Math.min(8, Math.floor(value)));
}

function normalizePower(value: number): number {
	if (!Number.isFinite(value) || value < 0) return 0;
	return value;
}

export class Simulator201 extends EngineBase<Simulator201State> {
	override readonly version = '2.0.1' as const;
	readonly subprotocol = 'ocpp2.0.1' as const;
	private readonly station: Station201Options;

	constructor(options: Simulator201Options) {
		super(createSimulator201Profile(options.station), options);
		this.station = options.station;
	}

	sendHeartbeat(): Promise<JsonObject> {
		return this.sendCall('Heartbeat', {});
	}

	sendStatusNotification(evseId: number, status?: EvseStatus201): Promise<void> {
		const evse = this.state.evses.find((item) => item.id === evseId);
		if (evse === undefined) {
			return Promise.reject(new SimulatorError('invalid-options', 'Unknown EVSE'));
		}
		return sendStatusNotification(this, evse, status ?? evse.status);
	}

	sendAllStatusNotifications(): Promise<void> {
		return sendAllStatusNotifications(this);
	}

	authorize(idToken: string): Promise<boolean> {
		return authorize201(this, idToken, this.station.idTokenType ?? 'ISO14443');
	}

	startChargingSession(
		evseId: number,
		idToken?: string,
		idTokenType?: IdTokenKind201,
	): Promise<{ ok: boolean; transactionId?: string; reason?: string }> {
		return startChargingSession201(
			this,
			evseId,
			idToken ?? this.station.defaultIdToken ?? 'AABBCCDD',
			idTokenType ?? this.station.idTokenType ?? 'ISO14443',
		);
	}

	stopTransaction(evseId: number, reason = 'Local'): Promise<boolean> {
		return stopTransaction201(this, evseId, reason);
	}

	sendTransactionEvent(
		evseId: number,
		eventType: 'Started' | 'Updated' | 'Ended',
		triggerReason: string,
	): Promise<void> {
		const evse = this.state.evses.find((item) => item.id === evseId);
		const transaction = evse?.transaction;
		if (evse === undefined || transaction === null || transaction === undefined) {
			return Promise.reject(new SimulatorError('invalid-options', 'Unknown transaction'));
		}
		return sendTransactionEvent(this, evse, transaction, eventType, triggerReason, {
			includeMeter: true,
		});
	}

	sendMeterValues(evseId: number): Promise<void> {
		return sendMeterValues201(this, evseId);
	}

	sendNotifyEvent(
		component: string,
		variable: string,
		actualValue: string,
		trigger: 'Alerting' | 'Delta' | 'Periodic' = 'Alerting',
	): Promise<void> {
		this.state.monitoring.eventIdSeq += 1;
		return sendNotifyEvent201(this, {
			eventId: this.state.monitoring.eventIdSeq,
			timestamp: this.ocppNow(),
			trigger,
			actualValue,
			eventNotificationType: 'HardWiredNotification',
			component: { name: component },
			variable: { name: variable },
		});
	}

	sendReservationStatusUpdate(reservationId: number, status: 'Expired' | 'Removed'): Promise<void> {
		return sendReservationStatusUpdate201(this, reservationId, status);
	}

	sendFirmwareStatus(status: string, requestId?: number): Promise<void> {
		return sendFirmwareStatus201(this, status, requestId);
	}

	sendPublishFirmwareStatus(
		status: string,
		location?: string[],
		requestId?: number,
	): Promise<void> {
		return sendPublishFirmwareStatus201(this, status, location, requestId);
	}

	sendLogStatus(status: string, requestId?: number): Promise<void> {
		return sendLogStatus201(this, status, requestId);
	}

	sendNotifyDisplayMessages(
		requestId: number,
		messageInfo: JsonObject[],
		tbc = false,
	): Promise<void> {
		return sendNotifyDisplayMessages201(this, requestId, messageInfo, tbc);
	}

	sendNotifyCustomerInformation(
		requestId: number,
		data: string,
		seqNo = 0,
		tbc = false,
	): Promise<void> {
		return sendNotifyCustomerInformation201(this, requestId, data, seqNo, tbc);
	}

	sendNotifyChargingLimit(source: 'EMS' | 'Other' | 'SO' | 'CSO', evseId?: number): Promise<void> {
		return sendNotifyChargingLimit201(this, source, evseId);
	}

	sendClearedChargingLimit(source: 'EMS' | 'Other' | 'SO' | 'CSO', evseId?: number): Promise<void> {
		return sendClearedChargingLimit201(this, source, evseId);
	}

	sendNotifyEVChargingNeeds(
		evseId: number,
		mode: 'DC' | 'AC_single_phase' | 'AC_two_phase' | 'AC_three_phase' = 'AC_three_phase',
		extra: JsonObject = {},
	): Promise<void> {
		return sendNotifyEVChargingNeeds201(this, evseId, mode, extra);
	}

	sendNotifyEVChargingSchedule(evseId: number, chargingSchedule: JsonObject): Promise<void> {
		return sendNotifyEVChargingSchedule201(this, evseId, chargingSchedule);
	}

	setEvseStatus(evseId: number, status: EvseStatus201): void {
		const evse = this.state.evses.find((item) => item.id === evseId);
		if (evse !== undefined) {
			evse.status = status;
			evse.updatedAt = this.now();
			if (status === 'Unavailable' || status === 'Faulted') {
				void cancelEvseReservations201(this, evseId).catch((error: unknown) =>
					reportProfileError(this, error),
				);
			}
		}
	}

	setChargingPowerKw(evseId: number, kw: number): void {
		const evse = this.state.evses.find((item) => item.id === evseId);
		if (evse !== undefined) {
			evse.chargingPowerKw = normalizePower(kw);
			evse.defaultChargingPowerKw = normalizePower(kw);
		}
	}

	getEvse(evseId: number): Evse201 | undefined {
		return this.state.evses.find((item) => item.id === evseId);
	}
}
