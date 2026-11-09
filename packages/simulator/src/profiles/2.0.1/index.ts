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
import {
	createChargingHandlers,
	createChargingProfileState201,
	sendClearedChargingLimit201,
	sendNotifyChargingLimit201,
	sendNotifyEVChargingNeeds201,
	sendNotifyEVChargingSchedule201,
	type ChargingProfile201,
	type ChargingProfileState201,
} from './charging.js';
import {
	cancelFirmwareTimers201,
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
	containsPrivateKeyMaterial,
	createSecurityHandlers,
	createSecurityState201,
	sendGet15118EVCertificate201,
	sendGet15118EVCertificateMessage201,
	sendGetCertificateStatus201,
	sendSecurityEvent201,
	sendSignCertificate201,
	signWithProvider201,
	type SecurityOptions201,
	type SecurityState201,
	type SignWithProviderInput201,
	type SignWithProviderResult201,
	type SimulatedCertificate201,
} from './security.js';
import {
	catalogVariablesFromState201,
	createDeviceModelHandlers,
	createDeviceModelVariables201,
	createMonitoringState201,
	evaluateMonitors201,
	cancelMonitoringTimers201,
	isDeviceModelVariable201,
	knownDeviceModelComponent201,
	rearmMonitoringTimers201,
	sendNotifyEvent201,
	variableCharacteristics201,
	type MonitoringBase201,
	type MonitoringState201,
	type NetworkProfile201,
	type VariableMonitor201,
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
	type LocalAuthorizationEntry201,
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
	security: SecurityState201;
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
	/** Opt-in real certificate integration. Defaults to simulated. */
	readonly security?: SecurityOptions201;
}

export interface DeviceModelApi201 {
	variables(): Record<string, string>;
	sendReport(options: NotifyReportOptions201): Promise<void>;
	sendMonitoringReport(options: NotifyMonitoringReportOptions201): Promise<void>;
}

export interface MonitoringApi201 {
	list(): VariableMonitor201[];
	setBase(base: MonitoringBase201): Promise<JsonObject>;
	setLevel(severity: number): Promise<JsonObject>;
	sendReport(options: NotifyMonitoringReportOptions201): Promise<void>;
}

export interface LocalAuthApi201 {
	getVersion(): number;
	list(): LocalAuthorizationEntry201[];
	clearCache(): void;
}

export interface ReservationsApi201 {
	list(): Reservation201[];
	sendStatusUpdate(reservationId: number, status: 'Expired' | 'Removed'): Promise<void>;
}

export interface ChargingProfilesApi201 {
	list(): ChargingProfile201[];
	sendLimit(source: 'EMS' | 'Other' | 'SO' | 'CSO', evseId?: number): Promise<void>;
	sendCleared(source: 'EMS' | 'Other' | 'SO' | 'CSO', evseId?: number): Promise<void>;
}

export interface DisplayApi201 {
	list(): JsonObject[];
	send(requestId: number, messageInfo: JsonObject[], tbc?: boolean): Promise<void>;
}

export interface CertificatesApi201 {
	list(): SimulatedCertificate201[];
	sign(csr: string, type?: 'ChargingStationCertificate' | 'V2GCertificate'): Promise<JsonObject>;
	signWithProvider(input: SignWithProviderInput201): Promise<SignWithProviderResult201>;
	get15118(
		schemaVersion: string,
		action: 'Install' | 'Update',
		exiRequest: string,
	): Promise<JsonObject>;
	get15118Message(
		schemaVersion: string,
		action: 'Install' | 'Update',
		payload: unknown,
	): Promise<unknown>;
	getStatus(ocspRequestData: JsonObject): Promise<JsonObject>;
	sendSecurityEvent(type: string, techInfo?: string): Promise<void>;
}

export interface FirmwareApi201 {
	sendStatus(status: string, requestId?: number): Promise<void>;
	sendPublishStatus(status: string, location?: string[], requestId?: number): Promise<void>;
	sendLogStatus(status: string, requestId?: number): Promise<void>;
}

export interface CustomerApi201 {
	sendCustomerInformation(
		requestId: number,
		data: string,
		seqNo?: number,
		tbc?: boolean,
	): Promise<void>;
	sendEVChargingNeeds(
		evseId: number,
		mode?: 'DC' | 'AC_single_phase' | 'AC_two_phase' | 'AC_three_phase',
		extra?: JsonObject,
	): Promise<void>;
	sendEVChargingSchedule(evseId: number, schedule: JsonObject): Promise<void>;
}

export interface TransactionsApi201 {
	startSession(
		evseId: number,
		idToken?: string,
	): Promise<{ ok: boolean; transactionId?: string; reason?: string }>;
	stop(evseId: number, reason?: string): Promise<boolean>;
	sendEvent(
		evseId: number,
		eventType: 'Started' | 'Updated' | 'Ended',
		triggerReason: string,
	): Promise<void>;
	meter(evseId: number): Promise<void>;
	status(evseId: number, status?: EvseStatus201): Promise<void>;
	get(evseId: number): Evse201 | undefined;
}

export interface AvailabilityApi201 {
	setStatus(evseId: number, status: EvseStatus201): Promise<void>;
	setPower(evseId: number, kw: number): void;
}

const meterLoops = new WeakMap<object, Map<number, () => void>>();

export function createSimulator201Profile(
	station: Station201Options,
	security?: SecurityOptions201,
): EngineProfile<Simulator201State> {
	const securityMode =
		security?.mode ?? (security?.validateCertificateChain === undefined ? 'simulated' : 'real');
	if (securityMode !== 'simulated' && securityMode !== 'real') {
		throw new SimulatorError('invalid-options', 'Invalid security mode');
	}
	if (securityMode === 'real' && security?.validateCertificateChain === undefined) {
		throw new SimulatorError(
			'invalid-options',
			'Real security mode requires validateCertificateChain',
		);
	}
	if (securityMode === 'simulated' && security?.validateCertificateChain !== undefined) {
		throw new SimulatorError(
			'invalid-options',
			'A certificate validator requires real security mode',
		);
	}
	if (
		security?.revocation !== undefined &&
		security.validateCertificateChain === undefined &&
		security.firmwareVerifier === undefined
	) {
		throw new SimulatorError(
			'invalid-options',
			'Revocation checking requires validateCertificateChain or firmwareVerifier',
		);
	}
	if (
		security?.trustStore !== undefined &&
		security.validateCertificateChain === undefined &&
		security.firmwareVerifier === undefined
	) {
		throw new SimulatorError(
			'invalid-options',
			'trustStore requires validateCertificateChain or firmwareVerifier',
		);
	}
	if (security?.allowUnknownRevocation === true && security.revocation === undefined) {
		throw new SimulatorError(
			'invalid-options',
			'allowUnknownRevocation requires a revocation checker',
		);
	}
	if (
		security?.callbackTimeoutMs !== undefined &&
		(!Number.isFinite(security.callbackTimeoutMs) || security.callbackTimeoutMs <= 0)
	) {
		throw new SimulatorError('invalid-options', 'callbackTimeoutMs must be a positive number');
	}
	const effectiveSecurity =
		security === undefined ? undefined : { ...security, mode: securityMode };
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
			variables: createDeviceModelVariables201(),
			completedTransactions: [],
			txSeq: 0,
			pendingResets: { station: false, evseIds: [] },
			monitoring: createMonitoringState201(),
			networkProfiles: [],
			localAuthorization: createLocalAuthorizationState201(),
			reservations: [],
			charging: createChargingProfileState201(),
			services: createServicesState201(),
			security: createSecurityState201(),
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
			registerInbound(engine, effectiveSecurity);
		},
		restoreState: (value) => restoreSimulator201State(value),
		onRestored: (engine) => {
			rearmReservations201(engine);
			rearmMonitoringTimers201(engine);
			cancelFirmwareTimers201(engine);
			const firmware = engine.state.services.firmware;
			if (
				firmware.status === 'DownloadScheduled' ||
				firmware.status === 'Downloading' ||
				firmware.status === 'Downloaded' ||
				firmware.status === 'SignatureVerified' ||
				firmware.status === 'InstallScheduled' ||
				firmware.status === 'Installing'
			) {
				firmware.status = 'Idle';
				delete firmware.update;
				delete firmware.requestId;
			}
			if (engine.isReady) {
				for (const evse of engine.state.evses) {
					if (evse.transaction !== null) {
						startMeterLoop(engine, evse.id, engine.getMeterValueIntervalMs());
					}
				}
			}
		},
		onReady: async (engine) => {
			await sendAllStatusNotifications(engine);
			rearmReservations201(engine);
			rearmMonitoringTimers201(engine);
			for (const evse of engine.state.evses) {
				if (evse.transaction !== null) {
					startMeterLoop(engine, evse.id, engine.getMeterValueIntervalMs());
				}
			}
		},
		onTransportClose: (engine) => {
			cancelMonitoringTimers201(engine);
			const loops = meterLoops.get(engine);
			if (loops !== undefined) {
				for (const cancel of loops.values()) cancel();
				loops.clear();
			}
		},
	};
}

const EVSE_STATUSES201 = ['Available', 'Occupied', 'Reserved', 'Unavailable', 'Faulted'] as const;
const CHARGING_STATES201 = [
	'EVConnected',
	'Charging',
	'SuspendedEV',
	'SuspendedEVSE',
	'Idle',
] as const;
const ID_TOKEN_KINDS201 = [
	'Central',
	'eMAID',
	'ISO14443',
	'ISO15693',
	'KeyCode',
	'Local',
	'MacAddress',
	'NoAuthorization',
] as const;
const MONITOR_TYPES201 = [
	'UpperThreshold',
	'LowerThreshold',
	'Delta',
	'Periodic',
	'PeriodicClockAligned',
] as const;

function invalid201(message: string): never {
	throw new SimulatorError('invalid-snapshot', message);
}

function restoreSimulator201State(value: unknown): Simulator201State {
	if (!isRecord(value)) {
		invalid201('The 2.0.1 state must be an object');
	}
	return {
		evses: restoreEvses201(value['evses']),
		variables: restoreVariables201(value['variables']),
		completedTransactions: restoreCompleted201(value['completedTransactions']),
		txSeq: restoreInteger201(value['txSeq'], 'txSeq', 0),
		pendingResets: restorePendingResets201(value['pendingResets']),
		monitoring: restoreMonitoring201(value['monitoring']),
		networkProfiles: restoreNetworkProfiles201(value['networkProfiles']),
		localAuthorization: restoreLocalAuth201(value['localAuthorization']),
		reservations: restoreReservations201(value['reservations']),
		charging: restoreCharging201(value['charging']),
		services: restoreServices201(value['services']),
		security: restoreSecurity201(value['security']),
	};
}

function restoreInteger201(value: unknown, name: string, min = 0): number {
	if (!isInteger(value) || value < min) invalid201(`${name} is invalid`);
	return value;
}

function restoreEvses201(value: unknown): Simulator201State['evses'] {
	if (!Array.isArray(value) || value.length === 0) invalid201('evses must be a non-empty array');
	return value.map((entry, index) => {
		if (!isRecord(entry)) invalid201(`evses[${index}] is invalid`);
		const id = restoreInteger201(entry['id'], `evses[${index}].id`, 1);
		const connectorId = restoreInteger201(entry['connectorId'], `evses[${index}].connectorId`);
		const status = entry['status'];
		const operational = entry['operational'];
		const statusBeforeInoperative = entry['statusBeforeInoperative'];
		if (typeof status !== 'string' || !EVSE_STATUSES201.includes(status as never)) {
			invalid201(`evses[${index}].status is invalid`);
		}
		if (operational !== 'Operative' && operational !== 'Inoperative') {
			invalid201(`evses[${index}].operational is invalid`);
		}
		if (
			statusBeforeInoperative !== null &&
			(typeof statusBeforeInoperative !== 'string' ||
				!EVSE_STATUSES201.includes(statusBeforeInoperative as never))
		) {
			invalid201(`evses[${index}].statusBeforeInoperative is invalid`);
		}
		const pendingOperational = entry['pendingOperational'];
		if (
			pendingOperational !== null &&
			pendingOperational !== 'Operative' &&
			pendingOperational !== 'Inoperative'
		) {
			invalid201(`evses[${index}].pendingOperational is invalid`);
		}
		if (typeof entry['starting'] !== 'boolean') {
			invalid201(`evses[${index}].starting is invalid`);
		}
		const meterWh = entry['meterWh'];
		const chargingPowerKw = entry['chargingPowerKw'];
		const defaultChargingPowerKw = entry['defaultChargingPowerKw'];
		if (!isFiniteNumber(meterWh) || meterWh < 0) invalid201(`evses[${index}].meterWh is invalid`);
		if (!isFiniteNumber(chargingPowerKw) || chargingPowerKw < 0) {
			invalid201(`evses[${index}].chargingPowerKw is invalid`);
		}
		if (!isFiniteNumber(defaultChargingPowerKw) || defaultChargingPowerKw < 0) {
			invalid201(`evses[${index}].defaultChargingPowerKw is invalid`);
		}
		if (!isFiniteNumber(entry['updatedAt'])) {
			invalid201(`evses[${index}].updatedAt is invalid`);
		}
		return {
			id,
			connectorId,
			status: status as Simulator201State['evses'][number]['status'],
			operational: operational,
			statusBeforeInoperative:
				statusBeforeInoperative as Simulator201State['evses'][number]['statusBeforeInoperative'],
			meterWh,
			chargingPowerKw,
			defaultChargingPowerKw,
			transaction: restoreTransaction201(entry['transaction'], index),
			pendingOperational: pendingOperational,
			starting: false,
			updatedAt: entry['updatedAt'],
		};
	});
}

function restoreTransaction201(
	value: unknown,
	index: number,
): Simulator201State['evses'][number]['transaction'] {
	if (value === null) return null;
	if (!isRecord(value)) invalid201(`evses[${index}].transaction is invalid`);
	const transactionId = value['transactionId'];
	const idToken = value['idToken'];
	const idTokenType = value['idTokenType'];
	const chargingState = value['chargingState'];
	if (typeof transactionId !== 'string' || transactionId === '') {
		invalid201(`evses[${index}].transaction.transactionId is invalid`);
	}
	if (typeof idToken !== 'string' || idToken === '') {
		invalid201(`evses[${index}].transaction.idToken is invalid`);
	}
	if (typeof idTokenType !== 'string' || !ID_TOKEN_KINDS201.includes(idTokenType as never)) {
		invalid201(`evses[${index}].transaction.idTokenType is invalid`);
	}
	if (typeof chargingState !== 'string' || !CHARGING_STATES201.includes(chargingState as never)) {
		invalid201(`evses[${index}].transaction.chargingState is invalid`);
	}
	if (
		!isFiniteNumber(value['startedAt']) ||
		!isInteger(value['seqNo']) ||
		!isFiniteNumber(value['meterStartWh']) ||
		typeof value['stopping'] !== 'boolean'
	) {
		invalid201(`evses[${index}].transaction is invalid`);
	}
	const remoteStartId = value['remoteStartId'];
	const reservationId = value['reservationId'];
	if (remoteStartId !== undefined && !isInteger(remoteStartId)) {
		invalid201(`evses[${index}].transaction.remoteStartId is invalid`);
	}
	if (reservationId !== undefined && !isInteger(reservationId)) {
		invalid201(`evses[${index}].transaction.reservationId is invalid`);
	}
	return {
		transactionId,
		idToken,
		idTokenType: idTokenType as IdTokenKind201,
		startedAt: value['startedAt'],
		chargingState: chargingState as ChargingState201,
		seqNo: value['seqNo'],
		meterStartWh: value['meterStartWh'],
		...(remoteStartId === undefined ? {} : { remoteStartId }),
		...(reservationId === undefined ? {} : { reservationId }),
		stopping: false,
	};
}

function restoreVariables201(value: unknown): Simulator201State['variables'] {
	if (!isRecord(value)) invalid201('variables must be an object');
	const variables = createDeviceModelVariables201();
	for (const [key, entry] of Object.entries(value)) {
		if (key === '__proto__' || key === 'constructor' || key === 'prototype') {
			invalid201('variables contains a reserved key');
		}
		if (typeof entry !== 'string') invalid201(`variables.${key} is invalid`);
		variables[key] = entry;
	}
	return variables;
}

function restoreCompleted201(value: unknown): Simulator201State['completedTransactions'] {
	if (!Array.isArray(value)) invalid201('completedTransactions must be an array');
	return value.map((entry, index) => {
		if (!isRecord(entry)) invalid201(`completedTransactions[${index}] is invalid`);
		const { evseId, transactionId, idToken, energyWh, startedAt, stoppedAt, reason } = entry;
		if (
			!isInteger(evseId) ||
			typeof transactionId !== 'string' ||
			typeof idToken !== 'string' ||
			!isFiniteNumber(energyWh) ||
			!isFiniteNumber(startedAt) ||
			!isFiniteNumber(stoppedAt) ||
			typeof reason !== 'string'
		) {
			invalid201(`completedTransactions[${index}] is invalid`);
		}
		return { evseId, transactionId, idToken, energyWh, startedAt, stoppedAt, reason };
	});
}

function restorePendingResets201(value: unknown): Simulator201State['pendingResets'] {
	if (
		!isRecord(value) ||
		typeof value['station'] !== 'boolean' ||
		!Array.isArray(value['evseIds'])
	) {
		invalid201('pendingResets is invalid');
	}
	if (!value['evseIds'].every((id) => isInteger(id)))
		invalid201('pendingResets.evseIds is invalid');
	return { station: value['station'], evseIds: [...value['evseIds']] };
}

function restoreMonitoring201(value: unknown): Simulator201State['monitoring'] {
	if (!isRecord(value)) invalid201('monitoring is invalid');
	const base = value['base'];
	if (base !== 'All' && base !== 'FactoryDefault' && base !== 'HardWiredOnly') {
		invalid201('monitoring.base is invalid');
	}
	const level = restoreInteger201(value['level'], 'monitoring.level');
	if (level > 9) invalid201('monitoring.level is invalid');
	const monitors = value['monitors'];
	if (!Array.isArray(monitors)) invalid201('monitoring.monitors is invalid');
	const restoredMonitors = monitors.map((entry, index) => {
		if (!isRecord(entry)) invalid201(`monitoring.monitors[${index}] is invalid`);
		const type = entry['type'];
		if (typeof type !== 'string' || !MONITOR_TYPES201.includes(type as never)) {
			invalid201(`monitoring.monitors[${index}].type is invalid`);
		}
		if (
			!isInteger(entry['id']) ||
			!isRecord(entry['component']) ||
			!isRecord(entry['variable']) ||
			!isFiniteNumber(entry['value']) ||
			!isInteger(entry['severity']) ||
			typeof entry['transaction'] !== 'boolean' ||
			typeof entry['triggered'] !== 'boolean' ||
			(entry['lastReportedValue'] !== null && !isFiniteNumber(entry['lastReportedValue']))
		) {
			invalid201(`monitoring.monitors[${index}] is invalid`);
		}
		return {
			id: entry['id'],
			component: { ...entry['component'] } as JsonObject,
			variable: { ...entry['variable'] } as JsonObject,
			value: entry['value'],
			type: type as Simulator201State['monitoring']['monitors'][number]['type'],
			severity: entry['severity'],
			transaction: entry['transaction'],
			triggered: entry['triggered'],
			lastReportedValue: entry['lastReportedValue'],
		};
	});
	return {
		base,
		level,
		monitors: restoredMonitors,
		nextId: restoreInteger201(value['nextId'], 'monitoring.nextId', 1),
		eventIdSeq: restoreInteger201(value['eventIdSeq'], 'monitoring.eventIdSeq'),
	};
}

function restoreNetworkProfiles201(value: unknown): Simulator201State['networkProfiles'] {
	if (!Array.isArray(value)) invalid201('networkProfiles must be an array');
	return value.map((entry, index) => {
		if (
			!isRecord(entry) ||
			!isInteger(entry['configurationSlot']) ||
			!isRecord(entry['connectionData']) ||
			!isFiniteNumber(entry['updatedAt'])
		) {
			invalid201(`networkProfiles[${index}] is invalid`);
		}
		return {
			configurationSlot: entry['configurationSlot'],
			connectionData: { ...entry['connectionData'] } as JsonObject,
			updatedAt: entry['updatedAt'],
		};
	});
}

function restoreLocalAuth201(value: unknown): Simulator201State['localAuthorization'] {
	if (!isRecord(value)) invalid201('localAuthorization is invalid');
	const entries = value['entries'];
	if (!Array.isArray(entries)) invalid201('localAuthorization.entries is invalid');
	return {
		versionNumber: restoreInteger201(value['versionNumber'], 'localAuthorization.versionNumber'),
		entries: entries.map((entry, index) => {
			if (!isRecord(entry) || !isRecord(entry['idToken'])) {
				invalid201(`localAuthorization.entries[${index}] is invalid`);
			}
			const token = entry['idToken'];
			if (typeof token['idToken'] !== 'string' || typeof token['type'] !== 'string') {
				invalid201(`localAuthorization.entries[${index}].idToken is invalid`);
			}
			if (entry['idTokenInfo'] !== undefined && !isRecord(entry['idTokenInfo'])) {
				invalid201(`localAuthorization.entries[${index}].idTokenInfo is invalid`);
			}
			return {
				idToken: { idToken: token['idToken'], type: token['type'] },
				...(entry['idTokenInfo'] === undefined
					? {}
					: { idTokenInfo: { ...entry['idTokenInfo'] } as JsonObject }),
			};
		}),
	};
}

function restoreReservations201(value: unknown): Simulator201State['reservations'] {
	if (!Array.isArray(value)) invalid201('reservations must be an array');
	return value.map((entry, index) => {
		if (!isRecord(entry) || !isRecord(entry['idToken'])) {
			invalid201(`reservations[${index}] is invalid`);
		}
		const token = entry['idToken'];
		if (
			!isInteger(entry['id']) ||
			!isInteger(entry['evseId']) ||
			typeof entry['expiryDateTime'] !== 'string' ||
			typeof token['idToken'] !== 'string' ||
			typeof token['type'] !== 'string'
		) {
			invalid201(`reservations[${index}] is invalid`);
		}
		const group = entry['groupIdToken'];
		if (group !== undefined) {
			if (
				!isRecord(group) ||
				typeof group['idToken'] !== 'string' ||
				typeof group['type'] !== 'string'
			) {
				invalid201(`reservations[${index}].groupIdToken is invalid`);
			}
		}
		return {
			id: entry['id'],
			evseId: entry['evseId'],
			expiryDateTime: entry['expiryDateTime'],
			idToken: { idToken: token['idToken'], type: token['type'] },
			...(group === undefined
				? {}
				: {
						groupIdToken: {
							idToken: group['idToken'] as string,
							type: group['type'] as string,
						},
					}),
		};
	});
}

function restoreCharging201(value: unknown): Simulator201State['charging'] {
	if (!isRecord(value) || !Array.isArray(value['profiles'])) {
		invalid201('charging is invalid');
	}
	return {
		profiles: value['profiles'].map((entry, index) => {
			if (
				!isRecord(entry) ||
				!isInteger(entry['evseId']) ||
				!isRecord(entry['profile']) ||
				!isFiniteNumber(entry['receivedAt'])
			) {
				invalid201(`charging.profiles[${index}] is invalid`);
			}
			return {
				evseId: entry['evseId'],
				profile: { ...entry['profile'] } as JsonObject,
				receivedAt: entry['receivedAt'],
			};
		}),
	};
}

const FIRMWARE_STATUS_VALUES_201 = new Set([
	'Downloaded',
	'DownloadFailed',
	'Downloading',
	'DownloadScheduled',
	'DownloadPaused',
	'Idle',
	'InstallationFailed',
	'Installing',
	'Installed',
	'InstallRebooting',
	'InstallScheduled',
	'InstallVerificationFailed',
	'InvalidSignature',
	'SignatureVerified',
]);

function restoreServices201(value: unknown): Simulator201State['services'] {
	if (!isRecord(value)) invalid201('services is invalid');
	const displays = value['displays'];
	if (!Array.isArray(displays)) invalid201('services.displays is invalid');
	for (const [index, entry] of displays.entries()) {
		if (!isRecord(entry) || !isRecord(entry['message'])) {
			invalid201(`services.displays[${index}] is invalid`);
		}
	}
	if (
		!isRecord(value['cost']) ||
		!isRecord(value['customer']) ||
		!isRecord(value['firmware']) ||
		!isRecord(value['log'])
	) {
		invalid201('services is invalid');
	}
	const firmware = value['firmware'];
	if (!isRecord(firmware)) invalid201('services.firmware is invalid');
	const firmwareStatus = firmware['status'];
	if (
		firmwareStatus !== undefined &&
		(typeof firmwareStatus !== 'string' || !FIRMWARE_STATUS_VALUES_201.has(firmwareStatus))
	) {
		invalid201('services.firmware.status is invalid');
	}
	const firmwareRequestId = firmware['requestId'];
	if (
		firmwareRequestId !== undefined &&
		(typeof firmwareRequestId !== 'number' || !Number.isInteger(firmwareRequestId))
	) {
		invalid201('services.firmware.requestId is invalid');
	}
	const restoredFirmware = { ...firmware };
	delete restoredFirmware['update'];
	const update = firmware['update'];
	if (update !== undefined) {
		if (!isRecord(update)) invalid201('services.firmware.update is invalid');
		const location = securityText(update['location'], 'services.firmware.update.location');
		const retrieveDateTime = securityText(
			update['retrieveDateTime'],
			'services.firmware.update.retrieveDateTime',
		);
		const signature = securityText(update['signature'], 'services.firmware.update.signature');
		const signingCertificate = securityText(
			update['signingCertificate'],
			'services.firmware.update.signingCertificate',
		);
		const installDateTime = update['installDateTime'];
		if (
			location === '' ||
			location.trim() === '' ||
			location.length > 512 ||
			retrieveDateTime === '' ||
			!Number.isFinite(Date.parse(retrieveDateTime)) ||
			signature === '' ||
			signature.length > 800 ||
			signingCertificate === '' ||
			signingCertificate.length > 5500 ||
			(installDateTime !== undefined &&
				(typeof installDateTime !== 'string' ||
					containsPrivateKeyMaterial(installDateTime) ||
					!Number.isFinite(Date.parse(installDateTime))))
		) {
			invalid201('services.firmware.update is invalid');
		}
		restoredFirmware['update'] = {
			location,
			retrieveDateTime,
			...(typeof installDateTime === 'string' ? { installDateTime } : {}),
			signature,
			signingCertificate,
		};
	}
	return {
		displays: displays.map((entry) => ({
			message: { ...((entry as Record<string, unknown>)['message'] as JsonObject) },
		})),
		cost: { ...value['cost'] },
		customer: { ...value['customer'] },
		firmware: restoredFirmware,
		log: { ...value['log'] },
	};
}

function securityText(value: unknown, path: string): string {
	if (typeof value !== 'string' || containsPrivateKeyMaterial(value)) {
		invalid201(`${path} is invalid`);
	}
	return value;
}

function restoreSecurity201(value: unknown): Simulator201State['security'] {
	if (!isRecord(value)) invalid201('security is invalid');
	const certificates = value['certificates'];
	if (!Array.isArray(certificates)) invalid201('security.certificates is invalid');
	const restoredCertificates = certificates.map((entry, index) => {
		if (
			!isRecord(entry) ||
			!isRecord(entry['hash']) ||
			typeof entry['certificate'] !== 'string' ||
			containsPrivateKeyMaterial(entry['certificate']) ||
			!isFiniteNumber(entry['installedAt'])
		) {
			invalid201(`security.certificates[${index}] is invalid`);
		}
		const hash = entry['hash'];
		if (!isRecord(hash)) invalid201(`security.certificates[${index}] is invalid`);
		const hashAlgorithm = securityText(
			hash['hashAlgorithm'],
			`security.certificates[${index}].hash`,
		);
		if (hashAlgorithm !== 'SHA256' && hashAlgorithm !== 'SHA384' && hashAlgorithm !== 'SHA512') {
			invalid201(`security.certificates[${index}].hash is invalid`);
		}
		return {
			certificateType: securityText(
				entry['certificateType'],
				`security.certificates[${index}].certificateType`,
			),
			hash: {
				hashAlgorithm,
				issuerNameHash: securityText(
					hash['issuerNameHash'],
					`security.certificates[${index}].hash`,
				),
				issuerKeyHash: securityText(hash['issuerKeyHash'], `security.certificates[${index}].hash`),
				serialNumber: securityText(hash['serialNumber'], `security.certificates[${index}].hash`),
			},
			certificate: entry['certificate'],
			installedAt: entry['installedAt'],
		};
	});
	if (!isRecord(value['signedChains'])) invalid201('security.signedChains is invalid');
	const signedChains: Record<string, string> = {};
	for (const [key, entry] of Object.entries(value['signedChains'])) {
		securityText(key, 'security.signedChains key');
		signedChains[key] = securityText(entry, 'security.signedChains');
	}
	const events = value['events'];
	if (!Array.isArray(events)) invalid201('security.events is invalid');
	const restoredEvents = events.map((entry, index) => {
		if (!isRecord(entry)) invalid201(`security.events[${index}] is invalid`);
		return {
			type: securityText(entry['type'], `security.events[${index}].type`),
			timestamp: securityText(entry['timestamp'], `security.events[${index}].timestamp`),
			...(entry['techInfo'] === undefined
				? {}
				: {
						techInfo: securityText(entry['techInfo'], `security.events[${index}].techInfo`),
					}),
		};
	});
	return {
		certificates: restoredCertificates,
		signedChains,
		events: restoredEvents,
		nextSerial: restoreInteger201(value['nextSerial'], 'security.nextSerial', 1),
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

const resetInProgress = new WeakSet<object>();

function maybeRunPendingReset(engine: EngineBase<Simulator201State>): void {
	const pending = engine.state.pendingResets;
	if (pending.station) {
		if (engine.state.evses.some((evse) => evse.transaction !== null)) return;
		pending.station = false;
		pending.evseIds = [];
		emitResetNotice(engine);
		engine.reboot('ScheduledReset');
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
		countsAsError: !isAlreadyCountedError(error),
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
		delete transaction.reservationId;
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

export interface NotifyReportOptions201 {
	readonly requestId: number;
	readonly reportData?: readonly JsonObject[];
	readonly seqNo?: number;
	readonly tbc?: boolean;
}

export interface NotifyMonitoringReportOptions201 {
	readonly requestId: number;
	readonly monitor?: readonly JsonObject[];
	readonly seqNo?: number;
	readonly tbc?: boolean;
}

export async function sendNotifyReport201(
	engine: EngineBase<Simulator201State>,
	options: NotifyReportOptions201,
): Promise<void> {
	const reportData = options.reportData ?? reportDataFromVariables(engine);
	await engine.sendOrQueue('NotifyReport', {
		requestId: options.requestId,
		generatedAt: engine.ocppNow(),
		seqNo: options.seqNo ?? 0,
		tbc: options.tbc ?? false,
		...(reportData.length === 0 ? {} : { reportData: [...reportData] }),
	});
}

export async function sendNotifyMonitoringReport201(
	engine: EngineBase<Simulator201State>,
	options: NotifyMonitoringReportOptions201,
): Promise<void> {
	const monitor = options.monitor ?? monitoringDataFromState(engine);
	await engine.sendOrQueue('NotifyMonitoringReport', {
		requestId: options.requestId,
		generatedAt: engine.ocppNow(),
		seqNo: options.seqNo ?? 0,
		tbc: options.tbc ?? false,
		...(monitor.length === 0 ? {} : { monitor: [...monitor] }),
	});
}

function reportDataFromVariables(engine: EngineBase<Simulator201State>): JsonObject[] {
	const reportData: JsonObject[] = [];
	for (const [key, value] of Object.entries(engine.state.variables)) {
		if (!isDeviceModelVariable201(key)) continue;
		const split = key.indexOf('/');
		const component = split < 0 ? key : key.slice(0, split);
		const variable = split < 0 ? key : key.slice(split + 1);
		reportData.push({
			component: { name: component },
			variable: { name: variable },
			variableAttribute: [{ type: 'Actual', value, mutability: 'ReadWrite' }],
			variableCharacteristics: variableCharacteristics201(value),
		});
	}
	return reportData;
}

function monitoringDataFromState(engine: EngineBase<Simulator201State>): JsonObject[] {
	return engine.state.monitoring.monitors
		.filter((monitor) => isDeviceModelVariable201(variableKey(monitor.component, monitor.variable)))
		.map((monitor) => ({
			component: monitor.component,
			variable: monitor.variable,
			variableMonitoring: [
				{
					id: monitor.id,
					transaction: monitor.transaction,
					value: monitor.value,
					type: monitor.type,
					severity: monitor.severity,
				},
			],
		}));
}

export async function sendMeterValues201(
	engine: EngineBase<Simulator201State>,
	evseId: number,
	increment = false,
): Promise<void> {
	const evse = engine.state.evses.find((item) => item.id === evseId);
	if (evse === undefined) {
		throw new SimulatorError('invalid-options', 'Unknown EVSE');
	}
	await engine.sendOrQueue('MeterValues', {
		evseId: evse.id,
		meterValue: [buildMeterValue(engine, evse, engine.getMeterValueIntervalMs(), increment)],
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

function registerInbound(
	engine: EngineBase<Simulator201State>,
	security?: SecurityOptions201,
): void {
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
		InstallCertificate: { status: 'Rejected' },
		DeleteCertificate: { status: 'Failed' },
		GetInstalledCertificateIds: { status: 'NotFound' },
		CertificateSigned: { status: 'Rejected' },
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
			if (resetInProgress.has(engine)) {
				await context.reply({ status: 'Rejected' });
				return;
			}
			const active = targets.some((item) => item.transaction !== null);
			if (type === 'OnIdle' && active) {
				addPendingReset(engine, evseId);
				await context.reply({ status: 'Scheduled' });
				return;
			}
			clearPendingReset(engine, evseId);
			resetInProgress.add(engine);
			let accepted = false;
			try {
				await context.reply({ status: 'Accepted' });
				accepted = true;
				for (const evse of targets) {
					if (evse.transaction !== null) {
						await stopTransaction201(engine, evse.id, 'ImmediateReset', 'ResetCommand');
					}
				}
			} finally {
				if (accepted) {
					for (const evse of targets) {
						if (evse.transaction !== null) {
							stopMeterLoop(engine, evse.id);
							evse.transaction = null;
							evse.status = 'Available';
							evse.updatedAt = engine.now();
						}
					}
					if (evseId === undefined) {
						engine.reboot(type === 'Immediate' ? 'RemoteReset' : 'ScheduledReset');
					} else {
						emitResetNotice(engine);
					}
				}
				resetInProgress.delete(engine);
			}
		},
		TriggerMessage: async (context) => {
			const requested = stringValue(context.payload['requestedMessage'], '');
			const supported = [
				'BootNotification',
				'Heartbeat',
				'StatusNotification',
				'TransactionEvent',
				'MeterValues',
				'FirmwareStatusNotification',
				'LogStatusNotification',
				'PublishFirmwareStatusNotification',
			];
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
			if (requested === 'MeterValues') {
				const evseRef = objectValue(context.payload['evse']);
				const evseId = evseRef === undefined ? undefined : integerValue(evseRef['id']);
				const targets =
					evseId === undefined
						? engine.state.evses
						: engine.state.evses.filter((item) => item.id === evseId);
				if (targets.length === 0) {
					await context.reply({ status: 'Rejected' });
					return;
				}
				await context.reply({ status: 'Accepted' });
				for (const evse of targets) await sendMeterValues201(engine, evse.id);
				return;
			}
			if (requested === 'FirmwareStatusNotification') {
				const firmware = engine.state.services.firmware;
				const status =
					firmware.status === 'Installed' ||
					firmware.status === 'InstallationFailed' ||
					firmware.status === 'InstallVerificationFailed' ||
					firmware.status === 'InvalidSignature' ||
					firmware.status === 'DownloadFailed'
						? 'Idle'
						: (firmware.status ?? 'Idle');
				await context.reply({ status: 'Accepted' });
				await sendFirmwareStatus201(
					engine,
					status,
					status === 'Idle' ? undefined : firmware.requestId,
				);
				return;
			}
			if (requested === 'LogStatusNotification') {
				const log = engine.state.services.log;
				if (log.status !== 'Uploading') {
					await context.reply({ status: 'Rejected' });
					return;
				}
				await context.reply({ status: 'Accepted' });
				await sendLogStatus201(engine, 'Uploading', log.requestId);
				return;
			}
			if (requested === 'PublishFirmwareStatusNotification') {
				const firmware = engine.state.services.firmware;
				const status = firmware.publishStatus;
				if (status === undefined || status === 'Published') {
					await context.reply({ status: 'Accepted' });
					await sendPublishFirmwareStatus201(engine, 'Idle');
					return;
				}
				await context.reply({ status: 'Accepted' });
				await sendPublishFirmwareStatus201(
					engine,
					status,
					firmware.publish === undefined ? undefined : [firmware.publish.location],
					firmware.publish?.requestId,
				);
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
	Object.assign(handlers, createServicesHandlers(engine, security));
	Object.assign(handlers, createSecurityHandlers(engine, security));

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
	if (!knownDeviceModelComponent201(stringValue(component['name'], ''))) {
		result['attributeStatus'] = 'UnknownComponent';
		return result;
	}
	const key = variableKey(component, variable);
	if (!isDeviceModelVariable201(key)) return result;
	const value = engine.state.variables[key];
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
	if (!knownDeviceModelComponent201(stringValue(component['name'], ''))) {
		result['attributeStatus'] = 'UnknownComponent';
		return result;
	}
	const key = variableKey(component, variable);
	if (!isDeviceModelVariable201(key)) return result;
	if (typeof value !== 'string') {
		result['attributeStatus'] = 'Rejected';
		return result;
	}
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
	const reportData: JsonObject[] = [];
	for (const [key, value] of Object.entries(engine.state.variables)) {
		if (!isDeviceModelVariable201(key)) continue;
		const split = key.indexOf('/');
		const component = split < 0 ? key : key.slice(0, split);
		const variable = split < 0 ? key : key.slice(split + 1);
		const entry: JsonObject = {
			component: { name: component },
			variable: { name: variable },
			variableAttribute: [{ type: 'Actual', value, mutability: 'ReadWrite' }],
		};
		if (reportBase !== 'SummaryInventory') {
			entry['variableCharacteristics'] = variableCharacteristics201(value);
		}
		reportData.push(entry);
	}
	return reportData;
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

function clone<T>(value: T): T {
	return JSON.parse(JSON.stringify(value)) as T;
}

export class Simulator201 extends EngineBase<Simulator201State> {
	override readonly version = '2.0.1' as const;
	readonly subprotocol = 'ocpp2.0.1' as const;
	readonly deviceModel: DeviceModelApi201;
	readonly monitoring: MonitoringApi201;
	readonly localAuth: LocalAuthApi201;
	readonly reservations: ReservationsApi201;
	readonly chargingProfiles: ChargingProfilesApi201;
	readonly display: DisplayApi201;
	readonly certificates: CertificatesApi201;
	readonly firmware: FirmwareApi201;
	readonly customer: CustomerApi201;
	readonly transactions: TransactionsApi201;
	readonly availability: AvailabilityApi201;
	private readonly station: Station201Options;
	private readonly securityOptions: SecurityOptions201 | undefined;

	constructor(options: Simulator201Options) {
		super(createSimulator201Profile(options.station, options.security), options);
		this.station = options.station;
		this.securityOptions = options.security;
		this.deviceModel = {
			variables: () => catalogVariablesFromState201(this.state.variables),
			sendReport: (reportOptions) => sendNotifyReport201(this, reportOptions),
			sendMonitoringReport: (reportOptions) => sendNotifyMonitoringReport201(this, reportOptions),
		};
		this.monitoring = {
			list: () =>
				this.state.monitoring.monitors
					.filter((monitor) =>
						isDeviceModelVariable201(variableKey(monitor.component, monitor.variable)),
					)
					.map((monitor) => clone(monitor)),
			setBase: (base) => {
				if (base !== 'All' && base !== 'FactoryDefault' && base !== 'HardWiredOnly') {
					return Promise.resolve({ status: 'NotSupported' });
				}
				this.state.monitoring.base = base;
				if (base !== 'All') {
					cancelMonitoringTimers201(this);
					this.state.monitoring.monitors = [];
				}
				return Promise.resolve({ status: 'Accepted' });
			},
			setLevel: (severity) => {
				if (!Number.isInteger(severity) || severity < 0 || severity > 9) {
					return Promise.resolve({ status: 'Rejected' });
				}
				this.state.monitoring.level = severity;
				return Promise.resolve({ status: 'Accepted' });
			},
			sendReport: (reportOptions) => sendNotifyMonitoringReport201(this, reportOptions),
		};
		this.localAuth = {
			getVersion: () => this.state.localAuthorization.versionNumber,
			list: () => this.state.localAuthorization.entries.map((entry) => clone(entry)),
			clearCache: () => undefined,
		};
		this.reservations = {
			list: () => this.state.reservations.map((reservation) => clone(reservation)),
			sendStatusUpdate: (reservationId, status) =>
				sendReservationStatusUpdate201(this, reservationId, status),
		};
		this.chargingProfiles = {
			list: () => this.state.charging.profiles.map((profile) => clone(profile)),
			sendLimit: (source, evseId) => sendNotifyChargingLimit201(this, source, evseId),
			sendCleared: (source, evseId) => sendClearedChargingLimit201(this, source, evseId),
		};
		this.display = {
			list: () => this.state.services.displays.map((item) => clone(item.message)),
			send: (requestId, messageInfo, tbc) =>
				sendNotifyDisplayMessages201(this, requestId, [...messageInfo], tbc),
		};
		this.certificates = {
			list: () => this.state.security.certificates.map((certificate) => clone(certificate)),
			sign: (csr, type) => sendSignCertificate201(this, csr, type),
			signWithProvider: (input) => signWithProvider201(this, this.securityOptions, input),
			get15118: (schemaVersion, action, exiRequest) =>
				sendGet15118EVCertificate201(this, schemaVersion, action, exiRequest),
			get15118Message: (schemaVersion, action, payload) =>
				sendGet15118EVCertificateMessage201(
					this,
					this.securityOptions,
					schemaVersion,
					action,
					payload,
				),
			getStatus: (ocspRequestData) => sendGetCertificateStatus201(this, ocspRequestData),
			sendSecurityEvent: (type, techInfo) => sendSecurityEvent201(this, type, techInfo),
		};
		this.firmware = {
			sendStatus: (status, requestId) => sendFirmwareStatus201(this, status, requestId),
			sendPublishStatus: (status, location, requestId) =>
				sendPublishFirmwareStatus201(this, status, location, requestId),
			sendLogStatus: (status, requestId) => sendLogStatus201(this, status, requestId),
		};
		this.customer = {
			sendCustomerInformation: (requestId, data, seqNo, tbc) =>
				sendNotifyCustomerInformation201(this, requestId, data, seqNo, tbc),
			sendEVChargingNeeds: (evseId, mode, extra) =>
				sendNotifyEVChargingNeeds201(this, evseId, mode, extra),
			sendEVChargingSchedule: (evseId, schedule) =>
				sendNotifyEVChargingSchedule201(this, evseId, schedule),
		};
		this.transactions = {
			startSession: (evseId, idToken) =>
				startChargingSession201(
					this,
					evseId,
					idToken ?? this.station.defaultIdToken ?? 'AABBCCDD',
					this.station.idTokenType ?? 'ISO14443',
				),
			stop: (evseId, reason) => stopTransaction201(this, evseId, reason),
			sendEvent: (evseId, eventType, triggerReason) =>
				this.sendTransactionEvent(evseId, eventType, triggerReason),
			meter: (evseId) => sendMeterValues201(this, evseId),
			status: (evseId, status) => this.sendStatusNotification(evseId, status),
			get: (evseId) => this.getEvse(evseId),
		};
		this.availability = {
			setStatus: (evseId, status) => this.sendStatusNotification(evseId, status),
			setPower: (evseId, kw) => this.setChargingPowerKw(evseId, kw),
		};
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

	sendDataTransfer(payload: JsonObject): Promise<JsonObject> {
		return this.sendCall('DataTransfer', payload);
	}

	sendNotifyReport(options: NotifyReportOptions201): Promise<void> {
		return sendNotifyReport201(this, options);
	}

	sendNotifyMonitoringReport(options: NotifyMonitoringReportOptions201): Promise<void> {
		return sendNotifyMonitoringReport201(this, options);
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

	sendSignCertificate(
		csr: string,
		certificateType?: 'ChargingStationCertificate' | 'V2GCertificate',
	): Promise<JsonObject> {
		return sendSignCertificate201(this, csr, certificateType);
	}

	sendSignCertificateWithProvider(
		input: SignWithProviderInput201,
	): Promise<SignWithProviderResult201> {
		return signWithProvider201(this, this.securityOptions, input);
	}

	sendGet15118EVCertificate(
		iso15118SchemaVersion: string,
		action: 'Install' | 'Update',
		exiRequest: string,
	): Promise<JsonObject> {
		return sendGet15118EVCertificate201(this, iso15118SchemaVersion, action, exiRequest);
	}

	sendGet15118EVCertificateMessage(
		iso15118SchemaVersion: string,
		action: 'Install' | 'Update',
		payload: unknown,
	): Promise<unknown> {
		return sendGet15118EVCertificateMessage201(
			this,
			this.securityOptions,
			iso15118SchemaVersion,
			action,
			payload,
		);
	}

	sendGetCertificateStatus(ocspRequestData: JsonObject): Promise<JsonObject> {
		return sendGetCertificateStatus201(this, ocspRequestData);
	}

	sendSecurityEvent(type: string, techInfo?: string): Promise<void> {
		return sendSecurityEvent201(this, type, techInfo);
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

	runScenario(steps: readonly ScenarioStep[], options: ScenarioOptions = {}): ScenarioRun {
		return runScenario(
			this,
			{
				boot: () => this.bootNotification(),
				heartbeat: () => this.sendHeartbeat(),
				status: (step) =>
					this.sendStatusNotification(
						scenarioEntityId(step),
						step.status as EvseStatus201 | undefined,
					),
				authorize: (step) =>
					this.authorize(scenarioIdToken(step) ?? this.station.defaultIdToken ?? 'AABBCCDD'),
				start: (step) => this.startChargingSession(scenarioEntityId(step), scenarioIdToken(step)),
				meter: (step) => sendMeterValues201(this, scenarioEntityId(step)),
				stop: (step) => this.stopTransaction(scenarioEntityId(step), step.reason),
				call: (action, payload) => this.sendCall(action, payload),
			},
			steps,
			options,
		);
	}

	runChargingScenario(options: {
		evseId?: number;
		idToken?: string;
		durationMs?: number;
		readings?: number;
	}): { cancel: () => void; done: Promise<boolean> } {
		const evseId = options.evseId ?? 1;
		const readings = Math.max(0, options.readings ?? 1);
		const duration = Math.max(1000, options.durationMs ?? 5000);
		const waitMs = Math.floor(duration / (readings + 1));
		const steps: ScenarioStep[] = [
			{ type: 'start', entityId: evseId, idToken: options.idToken },
			...Array.from({ length: readings }, (): ScenarioStep[] => [
				{ type: 'wait', ms: waitMs },
				{ type: 'meter', entityId: evseId },
			]).flat(),
			{ type: 'stop', entityId: evseId, reason: 'Local' },
		];
		const run = this.runScenario(steps);
		return {
			cancel: () => run.cancel(),
			done: run.done.then((result) => result.status === 'completed'),
		};
	}
}
