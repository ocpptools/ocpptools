// SPDX-License-Identifier: Apache-2.0
// SPDX-FileCopyrightText: 2026 Rodolfo Carrillo

import type { JsonObject } from '@ocpptools/core';

import type { EngineBase } from '../../engine.js';
import type { CallContext } from '../../rpc.js';
import { SimulatorError, isAlreadyCountedError } from '../../errors.js';
import type { Simulator201State } from './index.js';

export interface DisplayMessage201 {
	message: JsonObject;
}

export interface ServicesState201 {
	displays: DisplayMessage201[];
	cost: { totalCost?: number; transactionId?: string };
	customer: { data?: string };
	firmware: {
		status?: string;
		requestId?: number;
		publishStatus?: string;
		publish?: { location: string; checksum: string; requestId: number };
	};
	log: { requestId?: number; status?: string };
}

export function createServicesState201(): ServicesState201 {
	return {
		displays: [],
		cost: {},
		customer: {},
		firmware: {},
		log: {},
	};
}

const firmwareTimers = new WeakMap<object, Array<() => void>>();
const logTimers = new WeakMap<object, Array<() => void>>();

export function createServicesHandlers(
	engine: EngineBase<Simulator201State>,
): Record<string, (context: CallContext) => void | Promise<void>> {
	return {
		SetDisplayMessage: async (context) => {
			const message = objectValue(context.payload['message']);
			if (message === undefined || !validMessage(message)) {
				await context.fail('FormatViolation', 'message is invalid');
				return;
			}
			const transactionId = message['transactionId'];
			if (typeof transactionId === 'string') {
				const active = engine.state.evses.some(
					(evse) => evse.transaction?.transactionId === transactionId,
				);
				if (!active) {
					await context.reply({ status: 'UnknownTransaction' });
					return;
				}
			}
			const id = integerValue(message['id']) ?? 0;
			const index = engine.state.services.displays.findIndex(
				(item) => integerValue(item.message['id']) === id,
			);
			if (index >= 0) engine.state.services.displays[index] = { message: message as JsonObject };
			else engine.state.services.displays.push({ message: message as JsonObject });
			await context.reply({ status: 'Accepted' });
		},
		ClearDisplayMessage: async (context) => {
			const id = integerValue(context.payload['id']);
			if (id === undefined) {
				await context.fail('FormatViolation', 'id must be an integer');
				return;
			}
			const index = engine.state.services.displays.findIndex(
				(item) => integerValue(item.message['id']) === id,
			);
			if (index < 0) {
				await context.reply({ status: 'Unknown' });
				return;
			}
			engine.state.services.displays.splice(index, 1);
			await context.reply({ status: 'Accepted' });
		},
		GetDisplayMessages: async (context) => {
			const requestId = integerValue(context.payload['requestId']);
			const rawId = context.payload['id'];
			const ids = rawId === undefined ? undefined : integerArray(rawId);
			const priority = context.payload['priority'];
			const state = context.payload['state'];
			if (
				requestId === undefined ||
				(rawId !== undefined && ids === undefined) ||
				(priority !== undefined && !validPriority(priority)) ||
				(state !== undefined && !validMessageState(state))
			) {
				await context.fail('FormatViolation', 'GetDisplayMessages filters are invalid');
				return;
			}
			const matches = engine.state.services.displays
				.map((item) => item.message)
				.filter(
					(message) =>
						displayActive201(engine, message) &&
						(ids === undefined || ids.includes(integerValue(message['id']) ?? -1)) &&
						(priority === undefined || message['priority'] === priority) &&
						(state === undefined || message['state'] === state),
				);
			if (matches.length === 0) {
				await context.reply({ status: 'Unknown' });
				return;
			}
			await context.reply({ status: 'Accepted' });
			await engine
				.sendOrQueue('NotifyDisplayMessages', {
					requestId,
					messageInfo: matches,
					tbc: false,
				})
				.catch((error: unknown) => reportServiceError(engine, error));
		},
		CostUpdated: async (context) => {
			const totalCost = context.payload['totalCost'];
			const transactionId = context.payload['transactionId'];
			if (typeof totalCost !== 'number' || typeof transactionId !== 'string') {
				await context.fail('FormatViolation', 'CostUpdated fields are invalid');
				return;
			}
			engine.state.services.cost = { totalCost, transactionId };
			await context.reply({});
		},
		CustomerInformation: async (context) => {
			const requestId = integerValue(context.payload['requestId']);
			const report = context.payload['report'];
			const clear = context.payload['clear'];
			if (requestId === undefined || typeof report !== 'boolean' || typeof clear !== 'boolean') {
				await context.fail('FormatViolation', 'CustomerInformation fields are invalid');
				return;
			}
			const idToken = objectValue(context.payload['idToken']);
			const identifier = context.payload['customerIdentifier'];
			const certificate = context.payload['customerCertificate'];
			if (idToken === undefined && identifier === undefined && certificate === undefined) {
				await context.reply({ status: 'Rejected' });
				return;
			}
			if (clear) engine.state.services.customer = {};
			const data = `customer-data-${requestId}`;
			if (report) engine.state.services.customer.data = data;
			await context.reply({ status: 'Accepted' });
			if (report) {
				await engine
					.sendOrQueue('NotifyCustomerInformation', {
						requestId,
						data,
						seqNo: 0,
						generatedAt: engine.ocppNow(),
						tbc: false,
					})
					.catch((error: unknown) => reportServiceError(engine, error));
			}
		},
		UpdateFirmware: async (context) => {
			const requestId = integerValue(context.payload['requestId']);
			const firmware = objectValue(context.payload['firmware']);
			if (
				requestId === undefined ||
				firmware === undefined ||
				typeof firmware['location'] !== 'string' ||
				typeof firmware['retrieveDateTime'] !== 'string'
			) {
				await context.fail('FormatViolation', 'UpdateFirmware fields are invalid');
				return;
			}
			const retrieveMs = Date.parse(firmware['retrieveDateTime']);
			const installMs =
				typeof firmware['installDateTime'] === 'string'
					? Date.parse(firmware['installDateTime'])
					: undefined;
			if (!Number.isFinite(retrieveMs)) {
				await context.reply({ status: 'Rejected' });
				return;
			}
			const previous = engine.state.services.firmware.status;
			const active =
				previous === 'DownloadScheduled' ||
				previous === 'Downloading' ||
				previous === 'Downloaded' ||
				previous === 'InstallScheduled' ||
				previous === 'Installing';
			cancelTimers(firmwareTimers, engine);
			const now = Date.parse(engine.ocppNow());
			const delay = Math.max(0, retrieveMs - now);
			const state = engine.state.services.firmware;
			state.status = delay > 0 ? 'DownloadScheduled' : 'Downloading';
			state.requestId = requestId;
			await context.reply({ status: active ? 'AcceptedCanceled' : 'Accepted' });
			const timers = timerBucket(firmwareTimers, engine);
			const notify = (status: string): void => {
				void sendFirmwareStatus201(engine, status, requestId).catch((error: unknown) =>
					reportServiceError(engine, error),
				);
			};
			notify(delay > 0 ? 'DownloadScheduled' : 'Downloading');
			timers.push(
				engine.scheduler.setTimeout(
					() => {
						if (delay > 0) {
							state.status = 'Downloading';
							notify('Downloading');
						}
						firmwareAfterDownload(engine, requestId, installMs, timers, notify);
					},
					delay > 0 ? delay : 1,
				),
			);
		},
		PublishFirmware: async (context) => {
			const location = context.payload['location'];
			const checksum = context.payload['checksum'];
			const requestId = integerValue(context.payload['requestId']);
			if (typeof location !== 'string' || typeof checksum !== 'string' || requestId === undefined) {
				await context.fail('FormatViolation', 'PublishFirmware fields are invalid');
				return;
			}
			engine.state.services.firmware.publish = { location, checksum, requestId };
			await context.reply({ status: 'Accepted' });
			await sendPublishFirmwareStatus201(engine, 'Published', [location], requestId).catch(
				(error: unknown) => reportServiceError(engine, error),
			);
		},
		UnpublishFirmware: async (context) => {
			const checksum = context.payload['checksum'];
			if (typeof checksum !== 'string') {
				await context.fail('FormatViolation', 'checksum must be a string');
				return;
			}
			if (engine.state.services.firmware.publish?.checksum !== checksum) {
				await context.reply({ status: 'NoFirmware' });
				return;
			}
			delete engine.state.services.firmware.publish;
			await context.reply({ status: 'Unpublished' });
		},
		GetLog: async (context) => {
			const requestId = integerValue(context.payload['requestId']);
			const logType = context.payload['logType'];
			const log = objectValue(context.payload['log']);
			if (
				requestId === undefined ||
				(logType !== 'DiagnosticsLog' && logType !== 'SecurityLog') ||
				log === undefined ||
				typeof log['remoteLocation'] !== 'string'
			) {
				await context.fail('FormatViolation', 'GetLog fields are invalid');
				return;
			}
			const uploading = engine.state.services.log.status === 'Uploading';
			cancelTimers(logTimers, engine);
			engine.state.services.log = { requestId, status: 'Uploading' };
			await context.reply({
				status: uploading ? 'AcceptedCanceled' : 'Accepted',
				filename: `log-${requestId}.log`,
			});
			await sendLogStatus201(engine, 'Uploading', requestId).catch((error: unknown) =>
				reportServiceError(engine, error),
			);
			const timers = timerBucket(logTimers, engine);
			timers.push(
				engine.scheduler.setTimeout(() => {
					engine.state.services.log.status = 'Uploaded';
					void sendLogStatus201(engine, 'Uploaded', requestId).catch((error: unknown) =>
						reportServiceError(engine, error),
					);
				}, 1000),
			);
		},
	};
}

export async function sendFirmwareStatus201(
	engine: EngineBase<Simulator201State>,
	status: string,
	requestId?: number,
): Promise<void> {
	await engine.sendOrQueue('FirmwareStatusNotification', {
		status,
		...(requestId === undefined ? {} : { requestId }),
	});
}

export async function sendPublishFirmwareStatus201(
	engine: EngineBase<Simulator201State>,
	status: string,
	location?: string[],
	requestId?: number,
): Promise<void> {
	engine.state.services.firmware.publishStatus = status;
	await engine.sendOrQueue('PublishFirmwareStatusNotification', {
		status,
		...(location === undefined ? {} : { location }),
		...(requestId === undefined ? {} : { requestId }),
	});
}

export async function sendLogStatus201(
	engine: EngineBase<Simulator201State>,
	status: string,
	requestId?: number,
): Promise<void> {
	await engine.sendOrQueue('LogStatusNotification', {
		status,
		...(requestId === undefined ? {} : { requestId }),
	});
}

export async function sendNotifyDisplayMessages201(
	engine: EngineBase<Simulator201State>,
	requestId: number,
	messageInfo: JsonObject[],
	tbc = false,
): Promise<void> {
	await engine.sendOrQueue('NotifyDisplayMessages', {
		requestId,
		messageInfo,
		tbc,
	});
}

export async function sendNotifyCustomerInformation201(
	engine: EngineBase<Simulator201State>,
	requestId: number,
	data: string,
	seqNo = 0,
	tbc = false,
): Promise<void> {
	await engine.sendOrQueue('NotifyCustomerInformation', {
		requestId,
		data,
		seqNo,
		generatedAt: engine.ocppNow(),
		tbc,
	});
}

function displayActive201(engine: EngineBase<Simulator201State>, message: JsonObject): boolean {
	const now = Date.parse(engine.ocppNow());
	const start =
		typeof message['startDateTime'] === 'string'
			? Date.parse(message['startDateTime'])
			: Number.NaN;
	const end =
		typeof message['endDateTime'] === 'string' ? Date.parse(message['endDateTime']) : Number.NaN;
	if (Number.isFinite(start) && start > now) return false;
	if (Number.isFinite(end) && end <= now) return false;
	return true;
}

export function removeTransactionDisplays201(
	engine: EngineBase<Simulator201State>,
	transactionId: string,
): void {
	engine.state.services.displays = engine.state.services.displays.filter(
		(item) => item.message['transactionId'] !== transactionId,
	);
}

function timerBucket(
	map: WeakMap<object, Array<() => void>>,
	engine: EngineBase<Simulator201State>,
): Array<() => void> {
	const bucket = map.get(engine) ?? [];
	map.set(engine, bucket);
	return bucket;
}

function cancelTimers(
	map: WeakMap<object, Array<() => void>>,
	engine: EngineBase<Simulator201State>,
): void {
	const bucket = map.get(engine);
	if (bucket === undefined) return;
	for (const cancel of bucket) cancel();
	bucket.length = 0;
}

function firmwareAfterDownload(
	engine: EngineBase<Simulator201State>,
	requestId: number,
	installMs: number | undefined,
	timers: Array<() => void>,
	notify: (status: string) => void,
): void {
	const state = engine.state.services.firmware;
	state.status = 'Downloaded';
	notify('Downloaded');
	const now = Date.parse(engine.ocppNow());
	const installDelay =
		installMs !== undefined && Number.isFinite(installMs) ? Math.max(0, installMs - now) : 500;
	state.status = 'InstallScheduled';
	notify('InstallScheduled');
	timers.push(
		engine.scheduler.setTimeout(() => {
			state.status = 'Installing';
			notify('Installing');
			timers.push(
				engine.scheduler.setTimeout(() => {
					state.status = 'Installed';
					notify('Installed');
				}, 500),
			);
		}, installDelay),
	);
}

function validMessage(message: Record<string, unknown>): boolean {
	if (integerValue(message['id']) === undefined || !validPriority(message['priority'])) {
		return false;
	}
	const content = objectValue(message['message']);
	if (content === undefined) return false;
	if (
		content['format'] !== 'ASCII' &&
		content['format'] !== 'HTML' &&
		content['format'] !== 'URI' &&
		content['format'] !== 'UTF8'
	) {
		return false;
	}
	return typeof content['content'] === 'string';
}

function validPriority(value: unknown): boolean {
	return value === 'AlwaysFront' || value === 'InFront' || value === 'NormalCycle';
}

function validMessageState(value: unknown): boolean {
	return value === 'Charging' || value === 'Faulted' || value === 'Idle' || value === 'Unavailable';
}

function objectValue(value: unknown): Record<string, unknown> | undefined {
	return typeof value === 'object' && value !== null && !Array.isArray(value)
		? (value as Record<string, unknown>)
		: undefined;
}

function integerValue(value: unknown): number | undefined {
	return typeof value === 'number' && Number.isInteger(value) ? value : undefined;
}

function integerArray(value: unknown): number[] | undefined {
	if (!Array.isArray(value) || value.length === 0) return undefined;
	const result: number[] = [];
	for (const entry of value) {
		const parsed = integerValue(entry);
		if (parsed === undefined) return undefined;
		result.push(parsed);
	}
	return result;
}

function reportServiceError(engine: EngineBase<Simulator201State>, error: unknown): void {
	engine.events.emit({
		type: 'error',
		at: engine.now(),
		error: {
			name: 'SimulatorError',
			code: error instanceof SimulatorError ? error.code : 'internal-error',
			message: error instanceof Error ? error.message : 'Service flow failed',
		},
		fatal: false,
		countsAsError: !isAlreadyCountedError(error),
	});
}
