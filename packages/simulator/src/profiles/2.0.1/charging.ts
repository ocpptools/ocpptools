// SPDX-License-Identifier: Apache-2.0
// SPDX-FileCopyrightText: 2026 Rodolfo Carrillo

import type { JsonObject } from '@ocpptools/core';

import type { EngineBase } from '../../engine.js';
import type { CallContext } from '../../rpc.js';
import { SimulatorError, isAlreadyCountedError } from '../../errors.js';
import type { Simulator201State } from './index.js';

export interface ChargingProfile201 {
	evseId: number;
	profile: JsonObject;
	/** Clock time when the profile was received, used for relative schedules. */
	receivedAt: number;
}

export interface ChargingProfileState201 {
	profiles: ChargingProfile201[];
}

export function createChargingProfileState201(): ChargingProfileState201 {
	return { profiles: [] };
}

export function createChargingHandlers(
	engine: EngineBase<Simulator201State>,
): Record<string, (context: CallContext) => void | Promise<void>> {
	return {
		SetChargingProfile: async (context) => {
			const evseId = integerValue(context.payload['evseId']);
			const profile = objectValue(context.payload['chargingProfile']);
			if (evseId === undefined || evseId < 0 || profile === undefined || !validProfile(profile)) {
				await context.fail('FormatViolation', 'chargingProfile is invalid');
				return;
			}
			if (evseId > 0 && !engine.state.evses.some((evse) => evse.id === evseId)) {
				await context.reply({ status: 'Rejected' });
				return;
			}
			const id = integerValue(profile['id']) ?? 0;
			const purpose = profile['chargingProfilePurpose'];
			const stackLevel = integerValue(profile['stackLevel']);
			if (purpose === 'TxProfile') {
				const evse = engine.state.evses.find((item) => item.id === evseId);
				const transaction = evse?.transaction;
				const requestedTransaction = profile['transactionId'];
				if (
					evse === undefined ||
					transaction === null ||
					transaction === undefined ||
					(typeof requestedTransaction === 'string' &&
						requestedTransaction !== transaction.transactionId)
				) {
					await context.reply({ status: 'Rejected' });
					return;
				}
			}
			const remaining = engine.state.charging.profiles.filter(
				(item) =>
					integerValue(item.profile['id']) !== id &&
					!(
						item.evseId === evseId &&
						item.profile['chargingProfilePurpose'] === purpose &&
						integerValue(item.profile['stackLevel']) === stackLevel
					),
			);
			engine.state.charging.profiles = [
				...remaining,
				{
					evseId,
					profile: profile as JsonObject,
					receivedAt: Date.parse(engine.ocppNow()),
				},
			];
			await context.reply({ status: 'Accepted' });
		},
		ClearChargingProfile: async (context) => {
			const profileId = integerValue(context.payload['chargingProfileId']);
			const rawCriteria = context.payload['chargingProfileCriteria'];
			const criteria = objectValue(rawCriteria);
			if (
				(context.payload['chargingProfileId'] !== undefined && profileId === undefined) ||
				(rawCriteria !== undefined && criteria === undefined)
			) {
				await context.fail('FormatViolation', 'ClearChargingProfile filters are invalid');
				return;
			}
			if (
				criteria !== undefined &&
				Object.keys(criteria).some(
					(key) =>
						key !== 'customData' &&
						key !== 'evseId' &&
						key !== 'chargingProfilePurpose' &&
						key !== 'stackLevel',
				)
			) {
				await context.fail('FormatViolation', 'ClearChargingProfile criteria has unknown fields');
				return;
			}
			const evseId = criteria === undefined ? undefined : integerValue(criteria['evseId']);
			const purpose = criteria?.['chargingProfilePurpose'];
			const stackLevel = criteria === undefined ? undefined : integerValue(criteria['stackLevel']);
			if (
				(criteria !== undefined && criteria['evseId'] !== undefined && evseId === undefined) ||
				(criteria !== undefined &&
					criteria['stackLevel'] !== undefined &&
					stackLevel === undefined) ||
				(purpose !== undefined && !validPurpose(purpose)) ||
				(evseId !== undefined && evseId < 0) ||
				(stackLevel !== undefined && stackLevel < 0)
			) {
				await context.fail('FormatViolation', 'ClearChargingProfile filters are invalid');
				return;
			}
			const hasCriteria = evseId !== undefined || purpose !== undefined || stackLevel !== undefined;
			const removed = engine.state.charging.profiles.filter((item) => {
				if (profileId !== undefined && integerValue(item.profile['id']) !== profileId) return false;
				if (evseId !== undefined && item.evseId !== evseId) return false;
				if (purpose !== undefined && item.profile['chargingProfilePurpose'] !== purpose) {
					return false;
				}
				if (stackLevel !== undefined && integerValue(item.profile['stackLevel']) !== stackLevel) {
					return false;
				}
				return profileId !== undefined || hasCriteria || criteria !== undefined;
			});
			if (removed.length === 0) {
				await context.reply({ status: 'Unknown' });
				return;
			}
			engine.state.charging.profiles = engine.state.charging.profiles.filter(
				(item) => !removed.includes(item),
			);
			await context.reply({ status: 'Accepted' });
		},
		GetChargingProfiles: async (context) => {
			const requestId = integerValue(context.payload['requestId']);
			const criteria = objectValue(context.payload['chargingProfile']);
			if (requestId === undefined || criteria === undefined) {
				await context.fail('FormatViolation', 'GetChargingProfiles fields are invalid');
				return;
			}
			const evseId = integerValue(context.payload['evseId']);
			if (context.payload['evseId'] !== undefined && evseId === undefined) {
				await context.fail('FormatViolation', 'evseId must be an integer');
				return;
			}
			const rawIds = criteria['chargingProfileId'];
			if (
				Object.keys(criteria).some(
					(key) =>
						key !== 'customData' &&
						key !== 'chargingProfilePurpose' &&
						key !== 'stackLevel' &&
						key !== 'chargingProfileId' &&
						key !== 'chargingLimitSource',
				)
			) {
				await context.fail('FormatViolation', 'chargingProfile criteria has unknown fields');
				return;
			}
			const profileIds = rawIds === undefined ? undefined : integerArray(rawIds);
			if (rawIds !== undefined && profileIds === undefined) {
				await context.fail('FormatViolation', 'chargingProfileId must be an integer array');
				return;
			}
			const rawSources = criteria['chargingLimitSource'];
			const sources = rawSources === undefined ? undefined : sourceArray(rawSources);
			if (rawSources !== undefined && sources === undefined) {
				await context.fail('FormatViolation', 'chargingLimitSource is invalid');
				return;
			}
			const purpose = criteria['chargingProfilePurpose'];
			if (purpose !== undefined && !validPurpose(purpose)) {
				await context.fail('FormatViolation', 'chargingProfilePurpose is invalid');
				return;
			}
			const stackLevel = integerValue(criteria['stackLevel']);
			if (criteria['stackLevel'] !== undefined && stackLevel === undefined) {
				await context.fail('FormatViolation', 'stackLevel must be an integer');
				return;
			}
			if (evseId !== undefined && evseId < 0) {
				await context.fail('FormatViolation', 'evseId must be zero or positive');
				return;
			}
			if (sources !== undefined && !sources.includes('CSO')) {
				await context.reply({ status: 'NoProfiles' });
				return;
			}
			const matches = engine.state.charging.profiles.filter((item) => {
				if (evseId !== undefined && item.evseId !== evseId) return false;
				if (
					profileIds !== undefined &&
					!profileIds.includes(integerValue(item.profile['id']) ?? -1)
				) {
					return false;
				}
				if (purpose !== undefined && item.profile['chargingProfilePurpose'] !== purpose)
					return false;
				if (stackLevel !== undefined && integerValue(item.profile['stackLevel']) !== stackLevel) {
					return false;
				}
				return true;
			});
			if (matches.length === 0) {
				await context.reply({ status: 'NoProfiles' });
				return;
			}
			await context.reply({ status: 'Accepted' });
			const byEvse = new Map<number, JsonObject[]>();
			for (const item of matches) {
				const list = byEvse.get(item.evseId) ?? [];
				list.push(item.profile);
				byEvse.set(item.evseId, list);
			}
			const groups = [...byEvse.entries()];
			for (let index = 0; index < groups.length; index += 1) {
				const [reportEvseId, profiles] = groups[index]!;
				await engine
					.sendOrQueue('ReportChargingProfiles', {
						requestId,
						chargingLimitSource: 'CSO',
						evseId: reportEvseId,
						chargingProfile: profiles,
						tbc: index < groups.length - 1,
					})
					.catch((error: unknown) => reportChargingError(engine, error));
			}
		},
		GetCompositeSchedule: async (context) => {
			const duration = integerValue(context.payload['duration']);
			const evseId = integerValue(context.payload['evseId']);
			const unit = context.payload['chargingRateUnit'];
			if (
				duration === undefined ||
				duration <= 0 ||
				evseId === undefined ||
				evseId < 0 ||
				(unit !== undefined && unit !== 'W' && unit !== 'A')
			) {
				await context.fail('FormatViolation', 'GetCompositeSchedule fields are invalid');
				return;
			}
			if (evseId > 0 && !engine.state.evses.some((evse) => evse.id === evseId)) {
				await context.reply({ status: 'Rejected' });
				return;
			}
			const rateUnit = unit === 'A' ? 'A' : 'W';
			const periods = compositePeriods(engine, evseId, rateUnit, duration);
			await context.reply({
				status: 'Accepted',
				schedule: {
					evseId,
					duration,
					scheduleStart: engine.ocppNow(),
					chargingRateUnit: rateUnit,
					chargingSchedulePeriod: periods,
				},
			});
		},
	};
}

export async function sendNotifyChargingLimit201(
	engine: EngineBase<Simulator201State>,
	source: 'EMS' | 'Other' | 'SO' | 'CSO',
	evseId?: number,
): Promise<void> {
	await engine.sendOrQueue('NotifyChargingLimit', {
		chargingLimit: { chargingLimitSource: source },
		...(evseId === undefined ? {} : { evseId }),
	});
}

export async function sendClearedChargingLimit201(
	engine: EngineBase<Simulator201State>,
	source: 'EMS' | 'Other' | 'SO' | 'CSO',
	evseId?: number,
): Promise<void> {
	await engine.sendOrQueue('ClearedChargingLimit', {
		chargingLimitSource: source,
		...(evseId === undefined ? {} : { evseId }),
	});
}

export async function sendNotifyEVChargingNeeds201(
	engine: EngineBase<Simulator201State>,
	evseId: number,
	energyTransferMode:
		'DC' | 'AC_single_phase' | 'AC_two_phase' | 'AC_three_phase' = 'AC_three_phase',
	extra: JsonObject = {},
): Promise<void> {
	await engine.sendOrQueue('NotifyEVChargingNeeds', {
		evseId,
		chargingNeeds: {
			requestedEnergyTransfer: energyTransferMode,
			...extra,
		},
	});
}

export async function sendNotifyEVChargingSchedule201(
	engine: EngineBase<Simulator201State>,
	evseId: number,
	chargingSchedule: JsonObject,
): Promise<void> {
	await engine.sendOrQueue('NotifyEVChargingSchedule', {
		timeBase: engine.ocppNow(),
		evseId,
		chargingSchedule,
	});
}

function compositePeriods(
	engine: EngineBase<Simulator201State>,
	evseId: number,
	unit: 'W' | 'A',
	duration: number,
): JsonObject[] {
	const nowMs = Date.parse(engine.ocppNow());
	const slots: ProfileWindow[] = [];
	for (const item of engine.state.charging.profiles) {
		if (item.evseId !== evseId && !(evseId > 0 && item.evseId === 0)) continue;
		if (item.profile['chargingProfilePurpose'] === 'TxProfile') {
			const evse = engine.state.evses.find((entry) => entry.id === item.evseId);
			const transaction = evse?.transaction;
			const transactionId = item.profile['transactionId'];
			if (
				transaction === null ||
				transaction === undefined ||
				(typeof transactionId === 'string' && transactionId !== transaction.transactionId)
			) {
				continue;
			}
		}
		const slot = profileWindow(item, nowMs, duration);
		if (slot !== undefined) slots.push(slot);
	}
	if (slots.length === 0) {
		return [{ startPeriod: 0, limit: defaultLimit(unit) }];
	}
	const boundaries = [
		...new Set(
			[
				0,
				duration,
				...slots.flatMap((slot) => [
					slot.start,
					slot.end,
					...slot.periods.map(
						(period) => (slot.scheduleStartMs + period.start * 1000 - nowMs) / 1000,
					),
				]),
			].map((value) => Math.floor(value)),
		),
	]
		.filter((value) => value >= 0 && value <= duration)
		.sort((left, right) => left - right);
	const periods: JsonObject[] = [];
	for (let index = 0; index < boundaries.length - 1; index += 1) {
		const start = boundaries[index] ?? 0;
		const selected = new Map<string, ProfileWindow>();
		for (const slot of slots) {
			if (slot.start > start || slot.end <= start) continue;
			const current = selected.get(slot.purpose);
			if (current === undefined || slot.stack > current.stack) {
				selected.set(slot.purpose, slot);
			}
		}
		if (selected.has('TxProfile')) selected.delete('TxDefaultProfile');
		let minimum = Number.POSITIVE_INFINITY;
		for (const slot of selected.values()) {
			const limit = windowLimitAt(slot, start, nowMs);
			if (limit !== undefined) {
				minimum = Math.min(minimum, convertLimit(limit, slot.unit, unit));
			}
		}
		const limit =
			minimum === Number.POSITIVE_INFINITY ? defaultLimit(unit) : Math.round(minimum * 100) / 100;
		const previous = periods.at(-1);
		if (previous !== undefined && previous['limit'] === limit) continue;
		periods.push({ startPeriod: start, limit });
	}
	return periods.length === 0 ? [{ startPeriod: 0, limit: defaultLimit(unit) }] : periods;
}

interface ProfileWindow {
	purpose: string;
	stack: number;
	unit: 'W' | 'A';
	start: number;
	end: number;
	scheduleStartMs: number;
	periods: Array<{ start: number; limit: number }>;
}

function profileWindow(
	profile: ChargingProfile201,
	nowMs: number,
	requestDuration: number,
): ProfileWindow | undefined {
	const validFrom = profile.profile['validFrom'];
	const validTo = profile.profile['validTo'];
	const validFromMs =
		typeof validFrom === 'string' && Number.isFinite(Date.parse(validFrom))
			? Date.parse(validFrom)
			: 0;
	const validToMs =
		typeof validTo === 'string' && Number.isFinite(Date.parse(validTo))
			? Date.parse(validTo)
			: Number.POSITIVE_INFINITY;
	const schedules = profile.profile['chargingSchedule'];
	if (!Array.isArray(schedules)) return undefined;
	const kind = profile.profile['chargingProfileKind'];
	for (const raw of schedules) {
		const schedule = objectValue(raw);
		if (schedule === undefined) continue;
		const scheduleUnit = schedule['chargingRateUnit'];
		if (scheduleUnit !== 'W' && scheduleUnit !== 'A') continue;
		const periodValues = schedule['chargingSchedulePeriod'];
		if (!Array.isArray(periodValues)) continue;
		const periods = periodValues
			.map((period) => {
				const object = objectValue(period);
				if (object === undefined) return undefined;
				const start = integerValue(object['startPeriod']);
				const limit = object['limit'];
				if (start === undefined || typeof limit !== 'number' || limit < 0) return undefined;
				return { start, limit };
			})
			.filter((period): period is { start: number; limit: number } => period !== undefined);
		if (periods.length === 0) continue;
		const scheduleStartValue = schedule['startSchedule'];
		const scheduleStartMs =
			kind === 'Absolute' && typeof scheduleStartValue === 'string'
				? Date.parse(scheduleStartValue)
				: profile.receivedAt;
		if (!Number.isFinite(scheduleStartMs)) continue;
		const scheduleDuration = integerValue(schedule['duration']);
		const windowDuration =
			scheduleDuration !== undefined && scheduleDuration > 0
				? Math.min(requestDuration, scheduleDuration)
				: requestDuration;
		const startMs = Math.max(validFromMs, scheduleStartMs, nowMs);
		const endMs = Math.min(
			validToMs,
			scheduleStartMs + windowDuration * 1000,
			nowMs + requestDuration * 1000,
		);
		if (endMs <= startMs) continue;
		return {
			purpose: stringValue(profile.profile['chargingProfilePurpose']),
			stack: integerValue(profile.profile['stackLevel']) ?? 0,
			unit: scheduleUnit,
			start: (startMs - nowMs) / 1000,
			end: (endMs - nowMs) / 1000,
			scheduleStartMs,
			periods,
		};
	}
	return undefined;
}

function windowLimitAt(
	slot: ProfileWindow,
	offsetSeconds: number,
	nowMs: number,
): number | undefined {
	const elapsed = (nowMs + offsetSeconds * 1000 - slot.scheduleStartMs) / 1000;
	const active = slot.periods
		.filter((period) => period.start <= elapsed)
		.sort((left, right) => right.start - left.start)[0];
	return active?.limit;
}

function stringValue(value: unknown): string {
	return typeof value === 'string' ? value : '';
}

function defaultLimit(unit: 'W' | 'A'): number {
	return unit === 'W' ? 11000 : Math.round((11000 / 690) * 100) / 100;
}

function convertLimit(limit: number, from: 'W' | 'A', to: 'W' | 'A'): number {
	if (from === to) return limit;
	return from === 'W' ? limit / 690 : limit * 690;
}

function validProfile(profile: Record<string, unknown>): boolean {
	if (
		integerValue(profile['id']) === undefined ||
		integerValue(profile['stackLevel']) === undefined ||
		!validPurpose(profile['chargingProfilePurpose']) ||
		(profile['chargingProfileKind'] !== 'Absolute' &&
			profile['chargingProfileKind'] !== 'Recurring' &&
			profile['chargingProfileKind'] !== 'Relative')
	) {
		return false;
	}
	const schedules = profile['chargingSchedule'];
	if (!Array.isArray(schedules) || schedules.length === 0) return false;
	return schedules.every((raw) => {
		const schedule = objectValue(raw);
		if (schedule === undefined || integerValue(schedule['id']) === undefined) return false;
		if (schedule['chargingRateUnit'] !== 'W' && schedule['chargingRateUnit'] !== 'A') return false;
		const periods = schedule['chargingSchedulePeriod'];
		if (!Array.isArray(periods) || periods.length === 0) return false;
		return periods.every((period) => {
			const object = objectValue(period);
			return (
				object !== undefined &&
				typeof object['startPeriod'] === 'number' &&
				typeof object['limit'] === 'number'
			);
		});
	});
}

function validPurpose(value: unknown): boolean {
	return (
		value === 'ChargingStationExternalConstraints' ||
		value === 'ChargingStationMaxProfile' ||
		value === 'TxDefaultProfile' ||
		value === 'TxProfile'
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

function sourceArray(value: unknown): Array<'EMS' | 'Other' | 'SO' | 'CSO'> | undefined {
	if (!Array.isArray(value) || value.length === 0) return undefined;
	const result: Array<'EMS' | 'Other' | 'SO' | 'CSO'> = [];
	for (const entry of value) {
		if (entry !== 'EMS' && entry !== 'Other' && entry !== 'SO' && entry !== 'CSO') {
			return undefined;
		}
		result.push(entry as 'EMS' | 'Other' | 'SO' | 'CSO');
	}
	return result;
}

function reportChargingError(engine: EngineBase<Simulator201State>, error: unknown): void {
	engine.events.emit({
		type: 'error',
		at: engine.now(),
		error: {
			name: 'SimulatorError',
			code: error instanceof SimulatorError ? error.code : 'internal-error',
			message: error instanceof Error ? error.message : 'Charging profile flow failed',
		},
		fatal: false,
		countsAsError: !isAlreadyCountedError(error),
	});
}
