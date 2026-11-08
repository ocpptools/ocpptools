// SPDX-License-Identifier: Apache-2.0
// SPDX-FileCopyrightText: 2026 Rodolfo Carrillo

import type { JsonObject } from '@ocpptools/core';

import type { EngineBase } from '../../engine.js';
import { SimulatorError } from '../../errors.js';
import type { CallContext } from '../../rpc.js';
import type { Evse201, Simulator201State } from './index.js';

export interface LocalAuthorizationEntry201 {
	idToken: { idToken: string; type: string };
	idTokenInfo?: JsonObject;
}

export interface LocalAuthorizationState201 {
	versionNumber: number;
	entries: LocalAuthorizationEntry201[];
}

export interface Reservation201 {
	id: number;
	evseId: number;
	expiryDateTime: string;
	idToken: { idToken: string; type: string };
	groupIdToken?: { idToken: string; type: string };
}

const timers = new WeakMap<object, Map<number, () => void>>();

const MAX_TIMER_DELAY = 2_147_483_647;

export function createLocalAuthorizationState201(): LocalAuthorizationState201 {
	return { versionNumber: 0, entries: [] };
}

export function createLocalAuthHandlers(
	engine: EngineBase<Simulator201State>,
): Record<string, (context: CallContext) => void | Promise<void>> {
	return {
		SendLocalList: async (context) => {
			const versionNumber = integerValue(context.payload['versionNumber']);
			const updateType = context.payload['updateType'];
			if (
				versionNumber === undefined ||
				versionNumber <= 0 ||
				(updateType !== 'Full' && updateType !== 'Differential')
			) {
				if (versionNumber === 0) {
					await context.reply({ status: 'Failed' });
					return;
				}
				await context.fail('FormatViolation', 'SendLocalList fields are invalid');
				return;
			}
			const rawList = context.payload['localAuthorizationList'];
			const parsed = rawList === undefined ? undefined : parseLocalList(rawList);
			if (rawList !== undefined && parsed === undefined) {
				await context.fail('FormatViolation', 'localAuthorizationList is invalid');
				return;
			}
			if (updateType === 'Full') {
				engine.state.localAuthorization.entries = parsed ?? [];
				engine.state.localAuthorization.versionNumber = versionNumber;
				await context.reply({ status: 'Accepted' });
				return;
			}
			if (versionNumber <= engine.state.localAuthorization.versionNumber) {
				await context.reply({ status: 'VersionMismatch' });
				return;
			}
			if (parsed === undefined) {
				engine.state.localAuthorization.versionNumber = versionNumber;
				await context.reply({ status: 'Accepted' });
				return;
			}
			const entries = engine.state.localAuthorization.entries;
			for (const entry of parsed) {
				const index = entries.findIndex(
					(item) => normalizeToken(item.idToken.idToken) === normalizeToken(entry.idToken.idToken),
				);
				if (entry.idTokenInfo === undefined) {
					if (index >= 0) entries.splice(index, 1);
					continue;
				}
				if (index >= 0) entries[index] = entry;
				else entries.push(entry);
			}
			engine.state.localAuthorization.versionNumber = versionNumber;
			await context.reply({ status: 'Accepted' });
		},
		GetLocalListVersion: async (context) => {
			await context.reply({
				versionNumber: engine.state.localAuthorization.versionNumber,
			});
		},
		ReserveNow: async (context) => {
			const id = integerValue(context.payload['id']);
			const expiryDateTime = context.payload['expiryDateTime'];
			const idToken = parseIdToken(context.payload['idToken']);
			const rawEvseId = context.payload['evseId'];
			const requestedEvseId = integerValue(rawEvseId);
			const rawGroupIdToken = context.payload['groupIdToken'];
			const groupIdToken =
				rawGroupIdToken === undefined ? undefined : parseIdToken(rawGroupIdToken);
			if (
				id === undefined ||
				typeof expiryDateTime !== 'string' ||
				idToken === undefined ||
				(rawEvseId !== undefined && requestedEvseId === undefined) ||
				(rawGroupIdToken !== undefined && groupIdToken === undefined)
			) {
				await context.fail('FormatViolation', 'ReserveNow fields are invalid');
				return;
			}
			const expiry = Date.parse(expiryDateTime);
			if (!Number.isFinite(expiry) || expiry <= Date.parse(engine.ocppNow())) {
				await context.reply({ status: 'Rejected' });
				return;
			}
			const existingIndex = engine.state.reservations.findIndex(
				(reservation) => reservation.id === id,
			);
			const existing = engine.state.reservations[existingIndex];
			const targetEvseId = requestedEvseId ?? existing?.evseId;
			const evse =
				targetEvseId === undefined
					? engine.state.evses.find(
							(item) =>
								item.operational === 'Operative' &&
								item.status === 'Available' &&
								item.transaction === null &&
								!engine.state.reservations.some((reservation) => reservation.evseId === item.id),
						)
					: engine.state.evses.find((item) => item.id === targetEvseId);
			if (evse === undefined) {
				await context.reply({
					status: requestedEvseId !== undefined ? 'Rejected' : stationReservationStatus(engine),
				});
				return;
			}
			if (evse.operational === 'Inoperative' || evse.status === 'Unavailable') {
				await context.reply({ status: 'Unavailable' });
				return;
			}
			if (evse.status === 'Faulted') {
				await context.reply({ status: 'Faulted' });
				return;
			}
			const reservedByOther = engine.state.reservations.some(
				(reservation) => reservation.evseId === evse.id && reservation.id !== id,
			);
			if (
				evse.transaction !== null ||
				reservedByOther ||
				(evse.status !== 'Available' &&
					!(evse.status === 'Reserved' && existing?.evseId === evse.id))
			) {
				await context.reply({ status: 'Occupied' });
				return;
			}
			const wasReserved = evse.status === 'Reserved';
			if (existing !== undefined) {
				engine.state.reservations.splice(existingIndex, 1);
				cancelReservationTimer(engine, existing.id);
				engine.events.emit({
					type: 'reservation',
					at: engine.now(),
					phase: 'cancelled',
					evseId: existing.evseId,
					reservationId: existing.id,
				});
			}
			const reservation: Reservation201 = {
				id,
				evseId: evse.id,
				expiryDateTime,
				idToken,
				...(groupIdToken === undefined ? {} : { groupIdToken }),
			};
			engine.state.reservations.push(reservation);
			if (!wasReserved) {
				evse.status = 'Reserved';
				evse.updatedAt = engine.now();
			}
			if (existing !== undefined && existing.evseId !== evse.id) {
				await releaseReservation(engine, existing).catch((error: unknown) =>
					reportLocalAuthError(engine, error),
				);
			}
			await context.reply({ status: 'Accepted' });
			if (!wasReserved) {
				await notifyEvseStatus(engine, evse, 'Reserved').catch((error: unknown) =>
					reportLocalAuthError(engine, error),
				);
			}
			engine.events.emit({
				type: 'reservation',
				at: engine.now(),
				phase: 'created',
				evseId: evse.id,
				reservationId: id,
			});
			armReservationTimer(engine, reservation);
		},
		CancelReservation: async (context) => {
			const reservationId = integerValue(context.payload['reservationId']);
			if (reservationId === undefined) {
				await context.fail('FormatViolation', 'reservationId must be an integer');
				return;
			}
			const index = engine.state.reservations.findIndex(
				(reservation) => reservation.id === reservationId,
			);
			if (index < 0) {
				await context.reply({ status: 'Rejected' });
				return;
			}
			const [reservation] = engine.state.reservations.splice(index, 1);
			if (reservation === undefined) {
				await context.reply({ status: 'Rejected' });
				return;
			}
			cancelReservationTimer(engine, reservation.id);
			await context.reply({ status: 'Accepted' });
			await releaseReservation(engine, reservation).catch((error: unknown) =>
				reportLocalAuthError(engine, error),
			);
			engine.events.emit({
				type: 'reservation',
				at: engine.now(),
				phase: 'cancelled',
				evseId: reservation.evseId,
				reservationId: reservation.id,
			});
		},
	};
}

/** Returns the local decision, or check-online when the token is not decisive. */
export type LocalAuthorizationDecision201 = 'accepted' | 'rejected' | 'check-online';

export function localAuthorizationDecision201(
	engine: EngineBase<Simulator201State>,
	idToken: string,
	evseId?: number,
): LocalAuthorizationDecision201 {
	const entry = engine.state.localAuthorization.entries.find(
		(item) => normalizeToken(item.idToken.idToken) === normalizeToken(idToken),
	);
	if (entry === undefined) return 'check-online';
	const fallback: LocalAuthorizationDecision201 = engine.isReady ? 'check-online' : 'rejected';
	if (entry.idTokenInfo === undefined) return fallback;
	if (entry.idTokenInfo['status'] !== 'Accepted') return fallback;
	const expiry = entry.idTokenInfo['cacheExpiryDateTime'];
	if (typeof expiry === 'string') {
		const at = Date.parse(expiry);
		if (!Number.isFinite(at) || at <= Date.parse(engine.ocppNow())) return fallback;
	}
	const evseIds = entry.idTokenInfo['evseId'];
	if (Array.isArray(evseIds) && evseIds.length > 0) {
		if (evseId === undefined || !evseIds.includes(evseId)) return 'rejected';
	}
	return 'accepted';
}

export function reservationAllows201(
	engine: EngineBase<Simulator201State>,
	evseId: number,
	idToken: string,
	groupIdToken?: string,
): boolean {
	const reservation = engine.state.reservations.find((item) => item.evseId === evseId);
	if (reservation === undefined) return true;
	return reservationMatches(reservation, idToken, groupIdToken);
}

/** Removes the matching reservation and cancels its timer before any await. */
export function takeReservation201(
	engine: EngineBase<Simulator201State>,
	evseId: number,
	idToken: string,
	groupIdToken?: string,
): Reservation201 | undefined {
	const index = engine.state.reservations.findIndex(
		(item) => item.evseId === evseId && reservationMatches(item, idToken, groupIdToken),
	);
	if (index < 0) return undefined;
	const [reservation] = engine.state.reservations.splice(index, 1);
	if (reservation !== undefined) cancelReservationTimer(engine, reservation.id);
	return reservation;
}

export async function restoreReservation201(
	engine: EngineBase<Simulator201State>,
	reservation: Reservation201,
): Promise<void> {
	if (engine.state.reservations.some((item) => item.id === reservation.id)) {
		// A newer reservation reused the ID; the stale claim must not replace it.
		return;
	}
	if (Date.parse(reservation.expiryDateTime) <= Date.parse(engine.ocppNow())) {
		await sendReservationStatusUpdate201(engine, reservation.id, 'Expired').catch(
			(error: unknown) => reportLocalAuthError(engine, error),
		);
		return;
	}
	const evse = engine.state.evses.find((item) => item.id === reservation.evseId);
	const occupiedByOther = engine.state.reservations.some(
		(item) => item.evseId === reservation.evseId && item.id !== reservation.id,
	);
	const usable =
		evse !== undefined &&
		evse.operational === 'Operative' &&
		evse.transaction === null &&
		(evse.status === 'Available' || evse.status === 'Reserved') &&
		!occupiedByOther;
	if (!usable) {
		if (evse?.statusBeforeInoperative === 'Reserved') {
			evse.statusBeforeInoperative = null;
		}
		await sendReservationStatusUpdate201(engine, reservation.id, 'Removed').catch(
			(error: unknown) => reportLocalAuthError(engine, error),
		);
		return;
	}
	engine.state.reservations.push(reservation);
	armReservationTimer(engine, reservation);
	if (evse.status !== 'Reserved') {
		await notifyEvseStatus(engine, evse, 'Reserved').catch((error: unknown) =>
			reportLocalAuthError(engine, error),
		);
	}
}

/** Returns the local group token associated with an entry, when present. */
export function localGroupToken201(
	engine: EngineBase<Simulator201State>,
	idToken: string,
): string | undefined {
	const entry = engine.state.localAuthorization.entries.find(
		(item) => normalizeToken(item.idToken.idToken) === normalizeToken(idToken),
	);
	const group = objectValue(entry?.idTokenInfo?.['groupIdToken']);
	if (group === undefined) return undefined;
	const value = stringValue(group['idToken']);
	return value === '' ? undefined : value;
}

/** Cancels every reservation of an EVSE that is no longer usable. */
export async function cancelEvseReservations201(
	engine: EngineBase<Simulator201State>,
	evseId: number,
): Promise<boolean> {
	const removed = engine.state.reservations.filter((item) => item.evseId === evseId);
	if (removed.length === 0) return false;
	const evse = engine.state.evses.find((item) => item.id === evseId);
	if (evse?.statusBeforeInoperative === 'Reserved') {
		evse.statusBeforeInoperative = null;
	}
	engine.state.reservations = engine.state.reservations.filter((item) => item.evseId !== evseId);
	for (const reservation of removed) {
		cancelReservationTimer(engine, reservation.id);
		engine.events.emit({
			type: 'reservation',
			at: engine.now(),
			phase: 'cancelled',
			evseId,
			reservationId: reservation.id,
		});
	}
	for (const reservation of removed) {
		await sendReservationStatusUpdate201(engine, reservation.id, 'Removed').catch(
			(error: unknown) => reportLocalAuthError(engine, error),
		);
	}
	return true;
}

export function rearmReservations201(engine: EngineBase<Simulator201State>): void {
	const map = timers.get(engine);
	if (map !== undefined) {
		for (const cancel of map.values()) cancel();
		map.clear();
	}
	for (const reservation of engine.state.reservations) {
		armReservationTimer(engine, reservation);
	}
}

export async function sendReservationStatusUpdate201(
	engine: EngineBase<Simulator201State>,
	reservationId: number,
	status: 'Expired' | 'Removed',
): Promise<void> {
	await engine.sendOrQueue('ReservationStatusUpdate', {
		reservationId,
		reservationUpdateStatus: status,
	});
}

function armReservationTimer(
	engine: EngineBase<Simulator201State>,
	reservation: Reservation201,
): void {
	const map = timers.get(engine) ?? new Map<number, () => void>();
	timers.set(engine, map);
	map.get(reservation.id)?.();
	const remaining = Date.parse(reservation.expiryDateTime) - Date.parse(engine.ocppNow());
	if (!Number.isFinite(remaining)) return;
	if (remaining <= 0) {
		void expireReservation(engine, reservation);
		return;
	}
	const delay = Math.min(remaining, MAX_TIMER_DELAY);
	const cancel = engine.scheduler.setTimeout(() => {
		map.delete(reservation.id);
		if (remaining > MAX_TIMER_DELAY) {
			const current = engine.state.reservations.find((item) => item.id === reservation.id);
			if (current !== undefined) armReservationTimer(engine, current);
			return;
		}
		void expireReservation(engine, reservation);
	}, delay);
	map.set(reservation.id, cancel);
}

function cancelReservationTimer(
	engine: EngineBase<Simulator201State>,
	reservationId: number,
): void {
	const map = timers.get(engine);
	const cancel = map?.get(reservationId);
	cancel?.();
	map?.delete(reservationId);
}

async function expireReservation(
	engine: EngineBase<Simulator201State>,
	reservation: Reservation201,
): Promise<void> {
	const index = engine.state.reservations.findIndex(
		(item) => item.id === reservation.id && item.evseId === reservation.evseId,
	);
	if (index < 0) return;
	engine.state.reservations.splice(index, 1);
	cancelReservationTimer(engine, reservation.id);
	await releaseReservation(engine, reservation).catch((error: unknown) =>
		reportLocalAuthError(engine, error),
	);
	engine.events.emit({
		type: 'reservation',
		at: engine.now(),
		phase: 'expired',
		evseId: reservation.evseId,
		reservationId: reservation.id,
	});
	await sendReservationStatusUpdate201(engine, reservation.id, 'Expired').catch((error: unknown) =>
		reportLocalAuthError(engine, error),
	);
}

async function releaseReservation(
	engine: EngineBase<Simulator201State>,
	reservation: Reservation201,
): Promise<void> {
	const evse = engine.state.evses.find((item) => item.id === reservation.evseId);
	if (evse === undefined) return;
	if (evse.operational === 'Inoperative') {
		if (evse.statusBeforeInoperative === 'Reserved') {
			evse.statusBeforeInoperative = null;
		}
		return;
	}
	if (evse.transaction !== null || evse.status !== 'Reserved') return;
	await notifyEvseStatus(engine, evse, 'Available');
}

async function notifyEvseStatus(
	engine: EngineBase<Simulator201State>,
	evse: Evse201,
	status: Evse201['status'],
): Promise<void> {
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

function parseLocalList(value: unknown): LocalAuthorizationEntry201[] | undefined {
	if (value === undefined) return undefined;
	if (!Array.isArray(value) || value.length === 0) return undefined;
	const entries: LocalAuthorizationEntry201[] = [];
	const seen = new Set<string>();
	for (const raw of value) {
		const object = objectValue(raw);
		if (object === undefined) return undefined;
		const idToken = parseIdToken(object['idToken']);
		if (idToken === undefined) return undefined;
		const key = normalizeToken(idToken.idToken);
		if (seen.has(key)) return undefined;
		seen.add(key);
		const info = object['idTokenInfo'];
		if (info === undefined) {
			entries.push({ idToken });
			continue;
		}
		const infoObject = objectValue(info);
		if (infoObject === undefined || !validAuthorizationStatus(infoObject['status'])) {
			return undefined;
		}
		const normalizedInfo: JsonObject = { status: infoObject['status'] as string };
		const cacheExpiry = infoObject['cacheExpiryDateTime'];
		if (cacheExpiry !== undefined) {
			if (typeof cacheExpiry !== 'string' || !Number.isFinite(Date.parse(cacheExpiry))) {
				return undefined;
			}
			normalizedInfo['cacheExpiryDateTime'] = cacheExpiry;
		}
		if (infoObject['evseId'] !== undefined) {
			const rawIds = infoObject['evseId'];
			if (!Array.isArray(rawIds) || rawIds.length === 0) return undefined;
			const ids = rawIds.filter(
				(entry): entry is number => typeof entry === 'number' && Number.isInteger(entry),
			);
			if (ids.length !== rawIds.length) return undefined;
			normalizedInfo['evseId'] = ids;
		}
		if (infoObject['groupIdToken'] !== undefined) {
			const group = parseIdToken(infoObject['groupIdToken']);
			if (group === undefined) return undefined;
			normalizedInfo['groupIdToken'] = group;
		}
		entries.push({ idToken, idTokenInfo: normalizedInfo });
	}
	return entries;
}

function parseIdToken(value: unknown): { idToken: string; type: string } | undefined {
	const object = objectValue(value);
	if (object === undefined) return undefined;
	const idToken = object['idToken'];
	const type = object['type'];
	if (typeof idToken !== 'string' || idToken === '') return undefined;
	if (!validIdTokenType(type)) return undefined;
	return { idToken, type };
}

function validIdTokenType(value: unknown): value is string {
	return (
		value === 'Central' ||
		value === 'eMAID' ||
		value === 'ISO14443' ||
		value === 'ISO15693' ||
		value === 'KeyCode' ||
		value === 'Local' ||
		value === 'MacAddress' ||
		value === 'NoAuthorization'
	);
}

function validAuthorizationStatus(value: unknown): boolean {
	return (
		value === 'Accepted' ||
		value === 'Blocked' ||
		value === 'ConcurrentTx' ||
		value === 'Expired' ||
		value === 'Invalid' ||
		value === 'NoCredit' ||
		value === 'NotAllowedTypeEVSE' ||
		value === 'NotAtThisLocation' ||
		value === 'NotAtThisTime' ||
		value === 'Unknown'
	);
}

function normalizeToken(value: string): string {
	return value.toLowerCase();
}

function reservationMatches(
	reservation: Reservation201,
	idToken: string,
	groupIdToken?: string,
): boolean {
	if (normalizeToken(reservation.idToken.idToken) === normalizeToken(idToken)) return true;
	if (groupIdToken === undefined) return false;
	if (normalizeToken(reservation.idToken.idToken) === normalizeToken(groupIdToken)) return true;
	return (
		reservation.groupIdToken !== undefined &&
		normalizeToken(reservation.groupIdToken.idToken) === normalizeToken(groupIdToken)
	);
}

function stationReservationStatus(
	engine: EngineBase<Simulator201State>,
): 'Occupied' | 'Faulted' | 'Unavailable' | 'Rejected' {
	const evses = engine.state.evses;
	if (evses.length === 0) return 'Rejected';
	if (evses.every((evse) => evse.operational === 'Inoperative' || evse.status === 'Unavailable')) {
		return 'Unavailable';
	}
	if (evses.some((evse) => evse.status === 'Faulted')) return 'Faulted';
	if (
		evses.some(
			(evse) =>
				evse.transaction !== null || evse.status === 'Occupied' || evse.status === 'Reserved',
		)
	) {
		return 'Occupied';
	}
	return 'Rejected';
}

function objectValue(value: unknown): Record<string, unknown> | undefined {
	return typeof value === 'object' && value !== null && !Array.isArray(value)
		? (value as Record<string, unknown>)
		: undefined;
}

function integerValue(value: unknown): number | undefined {
	return typeof value === 'number' && Number.isInteger(value) ? value : undefined;
}

function stringValue(value: unknown): string {
	return typeof value === 'string' ? value : '';
}

function reportLocalAuthError(engine: EngineBase<Simulator201State>, error: unknown): void {
	engine.events.emit({
		type: 'error',
		at: engine.now(),
		error: {
			name: 'SimulatorError',
			code: error instanceof SimulatorError ? error.code : 'internal-error',
			message: error instanceof Error ? error.message : 'Local authorization flow failed',
		},
		fatal: false,
	});
}
