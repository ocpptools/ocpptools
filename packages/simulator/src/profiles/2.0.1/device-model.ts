// SPDX-License-Identifier: Apache-2.0
// SPDX-FileCopyrightText: 2026 Rodolfo Carrillo

import type { JsonObject } from '@ocpptools/core';

import type { EngineBase } from '../../engine.js';
import type { CallContext } from '../../rpc.js';
import { SimulatorError } from '../../errors.js';
import type { Simulator201State } from './index.js';

export type MonitorType201 =
	'UpperThreshold' | 'LowerThreshold' | 'Delta' | 'Periodic' | 'PeriodicClockAligned';

export type MonitoringBase201 = 'All' | 'FactoryDefault' | 'HardWiredOnly';

export interface VariableMonitor201 {
	id: number;
	component: JsonObject;
	variable: JsonObject;
	value: number;
	type: MonitorType201;
	severity: number;
	transaction: boolean;
	triggered: boolean;
	lastReportedValue: number | null;
}

export interface MonitoringState201 {
	base: MonitoringBase201;
	level: number;
	monitors: VariableMonitor201[];
	nextId: number;
	eventIdSeq: number;
}

export interface NetworkProfile201 {
	configurationSlot: number;
	connectionData: JsonObject;
	updatedAt: number;
}

/** Builds the OCPP characteristics for a scalar simulated variable value. */
export function variableCharacteristics201(value: string): JsonObject {
	const trimmed = value.trim();
	const numeric = trimmed === '' ? Number.NaN : Number(trimmed);
	let dataType: string;
	if (value === 'true' || value === 'false') {
		dataType = 'boolean';
	} else if (Number.isInteger(numeric)) {
		dataType = 'integer';
	} else if (Number.isFinite(numeric)) {
		dataType = 'decimal';
	} else {
		dataType = 'string';
	}
	return {
		dataType,
		supportsMonitoring: dataType === 'integer' || dataType === 'decimal',
	};
}

export function createMonitoringState201(): MonitoringState201 {
	return {
		base: 'All',
		level: 9,
		monitors: [],
		nextId: 1,
		eventIdSeq: 0,
	};
}

export function createDeviceModelHandlers(
	engine: EngineBase<Simulator201State>,
): Record<string, (context: CallContext) => void | Promise<void>> {
	return {
		SetVariableMonitoring: async (context) => {
			const items = strictObjectArray(context.payload['setMonitoringData']);
			if (items === undefined || !items.every(validMonitorInput)) {
				await context.fail('FormatViolation', 'setMonitoringData is invalid');
				return;
			}
			const events: JsonObject[] = [];
			const results = items.map((item) => setMonitor(engine, item, events));
			await context.reply({ setMonitoringResult: results });
			for (const event of events) {
				await sendNotifyEvent201(engine, event).catch((error: unknown) =>
					reportDeviceModelError(engine, error),
				);
			}
		},
		ClearVariableMonitoring: async (context) => {
			const ids = integerArray(context.payload['id']);
			if (ids === undefined) {
				await context.fail('FormatViolation', 'id must be a non-empty integer array');
				return;
			}
			const results = ids.map((id) => clearMonitor(engine, id));
			await context.reply({ clearMonitoringResult: results });
		},
		SetMonitoringBase: async (context) => {
			const base = stringValue(context.payload['monitoringBase'], '');
			if (base !== 'All' && base !== 'FactoryDefault' && base !== 'HardWiredOnly') {
				await context.reply({ status: 'NotSupported' });
				return;
			}
			engine.state.monitoring.base = base;
			if (base !== 'All') {
				// There are no hardwired or factory monitors in the simulator.
				engine.state.monitoring.monitors = [];
			}
			await context.reply({ status: 'Accepted' });
		},
		SetMonitoringLevel: async (context) => {
			const severity = integerValue(context.payload['severity']);
			if (severity === undefined) {
				await context.fail('FormatViolation', 'severity must be an integer');
				return;
			}
			if (severity < 0 || severity > 9) {
				await context.reply({ status: 'Rejected' });
				return;
			}
			engine.state.monitoring.level = severity;
			await context.reply({ status: 'Accepted' });
		},
		GetMonitoringReport: async (context) => {
			const requestId = integerValue(context.payload['requestId']);
			if (requestId === undefined) {
				await context.reply({ status: 'Rejected' });
				return;
			}
			const criteria = monitoringCriteria(context.payload['monitoringCriteria']);
			const filters = componentFilters(context.payload['componentVariable']);
			if (criteria === undefined || filters === undefined) {
				await context.fail('FormatViolation', 'Monitoring report filters are invalid');
				return;
			}
			const monitors = engine.state.monitoring.monitors.filter((monitor) => {
				if (
					criteria.length > 0 &&
					!criteria.some((value) => criterionMatches(value, monitor.type))
				) {
					return false;
				}
				return filters.length === 0 || filters.some((filter) => monitorMatches(monitor, filter));
			});
			if (monitors.length === 0) {
				await context.reply({ status: 'EmptyResultSet' });
				return;
			}
			await context.reply({ status: 'Accepted' });
			await engine
				.sendOrQueue('NotifyMonitoringReport', {
					requestId,
					generatedAt: engine.ocppNow(),
					seqNo: 0,
					tbc: false,
					monitor: monitors.map((monitor) => ({
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
					})),
				})
				.catch((error: unknown) => reportDeviceModelError(engine, error));
		},
		GetReport: async (context) => {
			const requestId = integerValue(context.payload['requestId']);
			if (requestId === undefined) {
				await context.reply({ status: 'Rejected' });
				return;
			}
			const filters = componentFilters(context.payload['componentVariable']);
			if (filters === undefined) {
				await context.fail('FormatViolation', 'componentVariable is invalid');
				return;
			}
			if (context.payload['componentCriteria'] !== undefined) {
				const criteria = context.payload['componentCriteria'];
				if (!Array.isArray(criteria) || criteria.length === 0) {
					await context.fail('FormatViolation', 'componentCriteria is invalid');
					return;
				}
				await context.reply({ status: 'NotSupported' });
				return;
			}
			const reportData = reportDataFor(engine, filters);
			if (reportData.length === 0) {
				await context.reply({ status: 'EmptyResultSet' });
				return;
			}
			await context.reply({ status: 'Accepted' });
			await engine
				.sendOrQueue('NotifyReport', {
					requestId,
					generatedAt: engine.ocppNow(),
					seqNo: 0,
					tbc: false,
					reportData,
				})
				.catch((error: unknown) => reportDeviceModelError(engine, error));
		},
		SetNetworkProfile: async (context) => {
			const slot = integerValue(context.payload['configurationSlot']);
			if (slot === undefined) {
				await context.fail('FormatViolation', 'configurationSlot must be an integer');
				return;
			}
			if (slot < 0 || slot > 2) {
				await context.reply({ status: 'Rejected' });
				return;
			}
			const connectionData = objectValue(context.payload['connectionData']);
			if (connectionData === undefined || !validConnectionData(connectionData)) {
				await context.reply({ status: 'Rejected' });
				return;
			}
			const existing = engine.state.networkProfiles.find(
				(profile) => profile.configurationSlot === slot,
			);
			const stored: NetworkProfile201 = {
				configurationSlot: slot,
				connectionData: connectionData as JsonObject,
				updatedAt: engine.now(),
			};
			if (existing === undefined) engine.state.networkProfiles.push(stored);
			else Object.assign(existing, stored);
			await context.reply({ status: 'Accepted' });
		},
	};
}

/** Sends one NotifyEvent message for a single event record. */
export async function sendNotifyEvent201(
	engine: EngineBase<Simulator201State>,
	eventData: JsonObject,
): Promise<void> {
	await engine.sendOrQueue('NotifyEvent', {
		generatedAt: engine.ocppNow(),
		seqNo: 0,
		tbc: false,
		eventData: [eventData],
	});
}

/**
 * Evaluates threshold monitors for one accepted variable change. Returns the
 * event records that must be sent after the SetVariables response.
 */
export function evaluateMonitors201(
	engine: EngineBase<Simulator201State>,
	componentName: string,
	variableName: string,
	previousValue: string | undefined,
	newValue: string,
): JsonObject[] {
	const numeric = Number(newValue);
	if (!Number.isFinite(numeric)) return [];
	const previous = previousValue === undefined ? undefined : Number(previousValue);
	const hasTransaction = engine.state.evses.some((evse) => evse.transaction !== null);
	const events: JsonObject[] = [];
	for (const monitor of engine.state.monitoring.monitors) {
		if (
			stringValue(monitor.component['name'], '') !== componentName ||
			stringValue(monitor.variable['name'], '') !== variableName
		) {
			continue;
		}
		if (monitor.transaction && !hasTransaction) continue;
		if (monitor.severity > engine.state.monitoring.level) continue;
		const event = evaluateMonitor(engine, monitor, previous, numeric);
		if (event !== undefined) events.push(event);
	}
	return events;
}

function evaluateMonitor(
	engine: EngineBase<Simulator201State>,
	monitor: VariableMonitor201,
	previous: number | undefined,
	current: number,
): JsonObject | undefined {
	if (monitor.type === 'UpperThreshold') {
		if (
			!monitor.triggered &&
			previous !== undefined &&
			previous <= monitor.value &&
			current > monitor.value
		) {
			return monitorEvent(engine, monitor, current, 'Alerting');
		}
		if (monitor.triggered && current <= monitor.value) {
			monitor.triggered = false;
			return monitorEvent(engine, monitor, current, 'Alerting', true);
		}
		return undefined;
	}
	if (monitor.type === 'LowerThreshold') {
		if (
			!monitor.triggered &&
			previous !== undefined &&
			previous >= monitor.value &&
			current < monitor.value
		) {
			return monitorEvent(engine, monitor, current, 'Alerting');
		}
		if (monitor.triggered && current >= monitor.value) {
			monitor.triggered = false;
			return monitorEvent(engine, monitor, current, 'Alerting', true);
		}
		return undefined;
	}
	if (monitor.type === 'Delta') {
		const baseline = monitor.lastReportedValue ?? previous;
		if (baseline !== undefined && Math.abs(current - baseline) > monitor.value) {
			return monitorEvent(engine, monitor, current, 'Delta');
		}
	}
	return undefined;
}

function monitorEvent(
	engine: EngineBase<Simulator201State>,
	monitor: VariableMonitor201,
	actual: number,
	trigger: 'Alerting' | 'Delta',
	cleared = false,
): JsonObject {
	if (!cleared && (monitor.type === 'UpperThreshold' || monitor.type === 'LowerThreshold')) {
		monitor.triggered = true;
	}
	monitor.lastReportedValue = actual;
	engine.state.monitoring.eventIdSeq += 1;
	const transaction = monitor.transaction
		? engine.state.evses.find((evse) => evse.transaction !== null)?.transaction
		: undefined;
	return {
		eventId: engine.state.monitoring.eventIdSeq,
		timestamp: engine.ocppNow(),
		trigger,
		actualValue: String(actual),
		eventNotificationType: 'CustomMonitor',
		component: monitor.component,
		variable: monitor.variable,
		variableMonitoringId: monitor.id,
		...(transaction === undefined || transaction === null
			? {}
			: { transactionId: transaction.transactionId }),
		...(cleared ? { cleared: true } : {}),
	};
}

function setMonitor(
	engine: EngineBase<Simulator201State>,
	item: Record<string, unknown>,
	events: JsonObject[],
): JsonObject {
	const component = componentRef(objectValue(item['component']) ?? {});
	const variable = variableRef(objectValue(item['variable']) ?? {});
	const type = stringValue(item['type'], '') as MonitorType201;
	const severity = integerValue(item['severity']) ?? 0;
	const id = integerValue(item['id']);
	const value = Number(item['value']);
	const transaction = item['transaction'] === true;
	const result: JsonObject = { status: 'Rejected', type, severity, component, variable };
	const componentName = stringValue(component['name'], '');
	const variableName = stringValue(variable['name'], '');
	if (!knownComponent(engine, componentName)) {
		result['status'] = 'UnknownComponent';
		return result;
	}
	const stored = engine.state.variables[`${componentName}/${variableName}`];
	if (stored === undefined) {
		result['status'] = 'UnknownVariable';
		return result;
	}
	if (type !== 'UpperThreshold' && type !== 'LowerThreshold' && type !== 'Delta') {
		result['status'] = 'UnsupportedMonitorType';
		return result;
	}
	if (!Number.isFinite(Number(stored))) {
		result['status'] = 'UnsupportedMonitorType';
		return result;
	}
	if (type === 'Delta' && value <= 0) return result;
	if (id !== undefined) {
		const existing = engine.state.monitoring.monitors.find((monitor) => monitor.id === id);
		if (existing === undefined) return result;
		if (!sameReference(existing, component, variable)) return result;
		const duplicate = engine.state.monitoring.monitors.some(
			(monitor) =>
				monitor.id !== id &&
				sameReference(monitor, component, variable) &&
				monitor.type === type &&
				monitor.severity === severity,
		);
		if (duplicate) {
			result['status'] = 'Duplicate';
			return result;
		}
		const previousType = existing.type;
		const wasTriggered =
			previousType === type &&
			(type === 'UpperThreshold' || type === 'LowerThreshold') &&
			existing.triggered;
		existing.value = value;
		existing.type = type;
		existing.severity = severity;
		existing.transaction = transaction;
		existing.lastReportedValue = null;
		result['status'] = 'Accepted';
		result['id'] = id;
		if (type === 'Delta') {
			existing.triggered = false;
			return result;
		}
		const current = Number(stored);
		const exceeds = type === 'UpperThreshold' ? current > value : current < value;
		existing.triggered = wasTriggered && exceeds;
		const hasTransaction = engine.state.evses.some((evse) => evse.transaction !== null);
		const canReport = severity <= engine.state.monitoring.level && (!transaction || hasTransaction);
		if (!canReport) return result;
		if (wasTriggered && !exceeds) {
			events.push(monitorEvent(engine, existing, current, 'Alerting', true));
		} else if (!wasTriggered && exceeds) {
			events.push(monitorEvent(engine, existing, current, 'Alerting'));
		}
		return result;
	}
	const duplicate = engine.state.monitoring.monitors.some(
		(monitor) =>
			sameReference(monitor, component, variable) &&
			monitor.type === type &&
			monitor.severity === severity,
	);
	if (duplicate) {
		result['status'] = 'Duplicate';
		return result;
	}
	const newId = engine.state.monitoring.nextId;
	engine.state.monitoring.nextId += 1;
	engine.state.monitoring.monitors.push({
		id: newId,
		component,
		variable,
		value,
		type,
		severity,
		transaction,
		triggered: false,
		lastReportedValue: null,
	});
	result['status'] = 'Accepted';
	result['id'] = newId;
	return result;
}

function clearMonitor(engine: EngineBase<Simulator201State>, id: number): JsonObject {
	const index = engine.state.monitoring.monitors.findIndex((monitor) => monitor.id === id);
	if (index < 0) return { status: 'NotFound', id };
	engine.state.monitoring.monitors.splice(index, 1);
	return { status: 'Accepted', id };
}

function validMonitorInput(item: Record<string, unknown>): boolean {
	const value = item['value'];
	const type = item['type'];
	const severity = item['severity'];
	return (
		typeof value === 'number' &&
		Number.isFinite(value) &&
		(type === 'UpperThreshold' ||
			type === 'LowerThreshold' ||
			type === 'Delta' ||
			type === 'Periodic' ||
			type === 'PeriodicClockAligned') &&
		typeof severity === 'number' &&
		Number.isInteger(severity) &&
		severity >= 0 &&
		severity <= 9 &&
		objectValue(item['component']) !== undefined &&
		objectValue(item['variable']) !== undefined &&
		(item['id'] === undefined || integerValue(item['id']) !== undefined) &&
		(item['transaction'] === undefined || typeof item['transaction'] === 'boolean')
	);
}

function monitoringCriteria(value: unknown): string[] | undefined {
	if (value === undefined) return [];
	if (!Array.isArray(value) || value.length === 0) return undefined;
	const criteria: string[] = [];
	for (const entry of value) {
		if (
			entry !== 'ThresholdMonitoring' &&
			entry !== 'DeltaMonitoring' &&
			entry !== 'PeriodicMonitoring'
		) {
			return undefined;
		}
		criteria.push(entry as string);
	}
	return criteria;
}

function criterionMatches(criterion: string, type: MonitorType201): boolean {
	if (criterion === 'ThresholdMonitoring') {
		return type === 'UpperThreshold' || type === 'LowerThreshold';
	}
	if (criterion === 'DeltaMonitoring') return type === 'Delta';
	return type === 'Periodic' || type === 'PeriodicClockAligned';
}

function componentFilters(value: unknown): MonitorFilter[] | undefined {
	if (value === undefined) return [];
	if (!Array.isArray(value) || value.length === 0) return undefined;
	const filters: MonitorFilter[] = [];
	for (const entry of value) {
		const object = objectValue(entry);
		const component = object === undefined ? undefined : objectValue(object['component']);
		if (object === undefined || component === undefined) return undefined;
		const componentName = stringValue(component['name'], '');
		if (componentName === '') return undefined;
		const variable = objectValue(object['variable']);
		filters.push({
			component: componentRef(component),
			...(variable === undefined ? {} : { variable: variableRef(variable) }),
		});
	}
	return filters;
}

interface MonitorFilter {
	component: JsonObject;
	variable?: JsonObject;
}

function monitorMatches(monitor: VariableMonitor201, filter: MonitorFilter): boolean {
	if (!sameComponent(monitor.component, filter.component)) return false;
	if (filter.variable !== undefined && !sameVariable(monitor.variable, filter.variable)) {
		return false;
	}
	return true;
}

function reportDataFor(
	engine: EngineBase<Simulator201State>,
	filters: MonitorFilter[],
): JsonObject[] {
	const reportData: JsonObject[] = [];
	for (const [key, value] of Object.entries(engine.state.variables)) {
		const split = key.indexOf('/');
		const componentName = split < 0 ? key : key.slice(0, split);
		const variableName = split < 0 ? key : key.slice(split + 1);
		const component = { name: componentName };
		const variable = { name: variableName };
		if (
			filters.length > 0 &&
			!filters.some(
				(filter) =>
					sameComponent(component, filter.component) &&
					(filter.variable === undefined || sameVariable(variable, filter.variable)),
			)
		) {
			continue;
		}
		reportData.push({
			component,
			variable,
			variableAttribute: [{ type: 'Actual', value, mutability: 'ReadWrite' }],
			variableCharacteristics: variableCharacteristics201(value),
		});
	}
	return reportData;
}

function validConnectionData(data: Record<string, unknown>): boolean {
	const url = stringValue(data['ocppCsmsUrl'], '');
	const timeout = integerValue(data['messageTimeout']);
	const securityProfile = integerValue(data['securityProfile']);
	const version = stringValue(data['ocppVersion'], '');
	const ocppInterface = stringValue(data['ocppInterface'], '');
	const validInterface =
		/^Wired[0-3]$/.test(ocppInterface) || /^Wireless[0-3]$/.test(ocppInterface);
	if (
		version !== 'OCPP12' &&
		version !== 'OCPP15' &&
		version !== 'OCPP16' &&
		version !== 'OCPP20'
	) {
		return false;
	}
	if (!validInterface) return false;
	if (!(url.startsWith('ws://') || url.startsWith('wss://'))) return false;
	if (timeout === undefined || timeout < 0) return false;
	if (securityProfile === undefined || securityProfile < 0 || securityProfile > 3) return false;
	if (data['ocppTransport'] !== 'JSON') return false;
	if (data['apn'] !== undefined) {
		const apn = objectValue(data['apn']);
		if (
			apn === undefined ||
			stringValue(apn['apn'], '') === '' ||
			(apn['apnAuthentication'] !== 'CHAP' &&
				apn['apnAuthentication'] !== 'NONE' &&
				apn['apnAuthentication'] !== 'PAP' &&
				apn['apnAuthentication'] !== 'AUTO')
		) {
			return false;
		}
	}
	if (data['vpn'] !== undefined) {
		const vpn = objectValue(data['vpn']);
		if (
			vpn === undefined ||
			stringValue(vpn['server'], '') === '' ||
			stringValue(vpn['user'], '') === '' ||
			stringValue(vpn['password'], '') === '' ||
			stringValue(vpn['key'], '') === '' ||
			(vpn['type'] !== 'IKEv2' &&
				vpn['type'] !== 'IPSec' &&
				vpn['type'] !== 'L2TP' &&
				vpn['type'] !== 'PPTP')
		) {
			return false;
		}
	}
	return true;
}

function sameReference(
	monitor: VariableMonitor201,
	component: JsonObject,
	variable: JsonObject,
): boolean {
	return sameComponent(monitor.component, component) && sameVariable(monitor.variable, variable);
}

function sameComponent(left: JsonObject, right: JsonObject): boolean {
	if (
		stringValue(left['name'], '').toLowerCase() !== stringValue(right['name'], '').toLowerCase()
	) {
		return false;
	}
	if (
		right['instance'] !== undefined &&
		stringValue(left['instance'], '') !== stringValue(right['instance'], '')
	) {
		return false;
	}
	const leftEvse = objectValue(left['evse']);
	const rightEvse = objectValue(right['evse']);
	if (rightEvse === undefined) return true;
	if (leftEvse === undefined) return false;
	if (integerValue(leftEvse['id']) !== integerValue(rightEvse['id'])) return false;
	return (
		rightEvse['connectorId'] === undefined ||
		integerValue(leftEvse['connectorId']) === integerValue(rightEvse['connectorId'])
	);
}

function sameVariable(left: JsonObject, right: JsonObject): boolean {
	if (
		stringValue(left['name'], '').toLowerCase() !== stringValue(right['name'], '').toLowerCase()
	) {
		return false;
	}
	return (
		right['instance'] === undefined ||
		stringValue(left['instance'], '') === stringValue(right['instance'], '')
	);
}

function componentRef(value: Record<string, unknown>): JsonObject {
	const result: JsonObject = { name: stringValue(value['name'], '') };
	if (typeof value['instance'] === 'string') result['instance'] = value['instance'];
	const evse = objectValue(value['evse']);
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

function variableRef(value: Record<string, unknown>): JsonObject {
	const result: JsonObject = { name: stringValue(value['name'], '') };
	if (typeof value['instance'] === 'string') result['instance'] = value['instance'];
	return result;
}

function knownComponent(engine: EngineBase<Simulator201State>, name: string): boolean {
	return Object.keys(engine.state.variables).some((key) => key.startsWith(`${name}/`));
}

function strictObjectArray(value: unknown): Record<string, unknown>[] | undefined {
	if (!Array.isArray(value) || value.length === 0) return undefined;
	const items: Record<string, unknown>[] = [];
	for (const entry of value) {
		const object = objectValue(entry);
		if (object === undefined) return undefined;
		items.push(object);
	}
	return items;
}

function integerArray(value: unknown): number[] | undefined {
	if (!Array.isArray(value) || value.length === 0) return undefined;
	const ids: number[] = [];
	for (const entry of value) {
		const id = integerValue(entry);
		if (id === undefined) return undefined;
		ids.push(id);
	}
	return ids;
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

function reportDeviceModelError(engine: EngineBase<Simulator201State>, error: unknown): void {
	engine.events.emit({
		type: 'error',
		at: engine.now(),
		error: {
			name: 'SimulatorError',
			code: error instanceof SimulatorError ? error.code : 'internal-error',
			message: error instanceof Error ? error.message : 'Device model notification failed',
		},
		fatal: false,
	});
}
