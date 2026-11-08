// SPDX-License-Identifier: Apache-2.0
// SPDX-FileCopyrightText: 2026 Rodolfo Carrillo

import { describe, expect, it } from 'vitest';

import { createHarness201, framePayload, type Harness201 } from './helpers/simulator-201.js';
import { flushMicrotasks } from './helpers/fake-clock.js';

async function call(
	harness: Harness201,
	messageId: string,
	action: string,
	payload: unknown,
): Promise<Record<string, unknown>> {
	harness.incoming(messageId, action, payload);
	await harness.ready();
	return framePayload(harness.reply(messageId));
}

async function errorCall(
	harness: Harness201,
	messageId: string,
	action: string,
	payload: unknown,
): Promise<unknown[]> {
	harness.incoming(messageId, action, payload);
	await harness.ready();
	return harness.reply(messageId) ?? [];
}

function authEntry(
	idToken: string,
	status = 'Accepted',
	extra: Record<string, unknown> = {},
): Record<string, unknown> {
	return {
		idToken: { idToken, type: 'ISO14443' },
		idTokenInfo: { status, ...extra },
	};
}

const MAX_TIMER_DELAY = 2_147_483_647;

function expiryIn(harness: Harness201, ms: number): string {
	return new Date(Date.parse(harness.simulator.ocppNow()) + ms).toISOString();
}

describe('Simulator201 local authorization and reservations', () => {
	it('replaces the local list and reports its version', async () => {
		const harness = createHarness201();
		await harness.ready();
		expect(
			await call(harness, 'list-1', 'SendLocalList', {
				versionNumber: 1,
				updateType: 'Full',
				localAuthorizationList: [authEntry('ABC')],
			}),
		).toEqual({ status: 'Accepted' });
		expect(harness.simulator.state.localAuthorization.versionNumber).toBe(1);
		expect(harness.simulator.state.localAuthorization.entries).toHaveLength(1);
		expect(await call(harness, 'list-2', 'GetLocalListVersion', {})).toEqual({
			versionNumber: 1,
		});
		expect(
			await call(harness, 'list-zero', 'SendLocalList', {
				versionNumber: 0,
				updateType: 'Full',
			}),
		).toEqual({ status: 'Failed' });
		expect(
			await call(harness, 'list-3', 'SendLocalList', {
				versionNumber: 2,
				updateType: 'Full',
			}),
		).toEqual({ status: 'Accepted' });
		expect(harness.simulator.state.localAuthorization.entries).toHaveLength(0);
		expect(harness.simulator.state.localAuthorization.versionNumber).toBe(2);
	});

	it('validates local list payloads atomically', async () => {
		const harness = createHarness201();
		await harness.ready();
		await call(harness, 'list-a', 'SendLocalList', {
			versionNumber: 1,
			updateType: 'Full',
			localAuthorizationList: [authEntry('ABC')],
		});
		expect(
			(
				await errorCall(harness, 'list-b', 'SendLocalList', {
					versionNumber: 2,
					updateType: 'Full',
					localAuthorizationList: [],
				})
			).slice(0, 3),
		).toEqual([4, 'list-b', 'FormatViolation']);
		expect(harness.simulator.state.localAuthorization.versionNumber).toBe(1);
		expect(
			(
				await errorCall(harness, 'list-c', 'SendLocalList', {
					versionNumber: 2,
					updateType: 'Full',
					localAuthorizationList: [authEntry('XYZ'), { idToken: { idToken: 'bad' } }],
				})
			).slice(0, 3),
		).toEqual([4, 'list-c', 'FormatViolation']);
		expect(harness.simulator.state.localAuthorization.entries).toHaveLength(1);
		expect(
			(
				await errorCall(harness, 'list-d', 'SendLocalList', {
					versionNumber: 2,
					updateType: 'Full',
					localAuthorizationList: [authEntry('same'), authEntry('SAME')],
				})
			).slice(0, 3),
		).toEqual([4, 'list-d', 'FormatViolation']);
		expect(
			(
				await errorCall(harness, 'list-e', 'SendLocalList', {
					versionNumber: 2,
					updateType: 'Bogus',
				})
			).slice(0, 3),
		).toEqual([4, 'list-e', 'FormatViolation']);
		expect(
			(
				await errorCall(harness, 'list-f', 'SendLocalList', {
					versionNumber: 2,
					updateType: 'Full',
					localAuthorizationList: [authEntry('A', 'NotAStatus')],
				})
			).slice(0, 3),
		).toEqual([4, 'list-f', 'FormatViolation']);
	});

	it('merges differential updates case-insensitively', async () => {
		const harness = createHarness201();
		await harness.ready();
		await call(harness, 'diff-1', 'SendLocalList', {
			versionNumber: 1,
			updateType: 'Full',
			localAuthorizationList: [authEntry('ABC'), authEntry('OLD')],
		});
		expect(
			await call(harness, 'diff-2', 'SendLocalList', {
				versionNumber: 1,
				updateType: 'Differential',
				localAuthorizationList: [authEntry('NEW')],
			}),
		).toEqual({ status: 'VersionMismatch' });
		expect(
			await call(harness, 'diff-3', 'SendLocalList', {
				versionNumber: 2,
				updateType: 'Differential',
				localAuthorizationList: [
					authEntry('abc', 'Blocked'),
					authEntry('NEW'),
					{ idToken: { idToken: 'old', type: 'ISO14443' } },
				],
			}),
		).toEqual({ status: 'Accepted' });
		expect(harness.simulator.state.localAuthorization.versionNumber).toBe(2);
		const entries = harness.simulator.state.localAuthorization.entries;
		expect(entries.map((entry) => entry.idToken.idToken)).toEqual(['abc', 'NEW']);
		expect(entries[0]?.idTokenInfo?.['status']).toBe('Blocked');
		expect(
			await call(harness, 'diff-4', 'SendLocalList', {
				versionNumber: 3,
				updateType: 'Differential',
			}),
		).toEqual({ status: 'Accepted' });
		expect(harness.simulator.state.localAuthorization.versionNumber).toBe(3);
		expect(
			await call(harness, 'diff-5', 'SendLocalList', {
				versionNumber: 3,
				updateType: 'Differential',
			}),
		).toEqual({ status: 'VersionMismatch' });
	});

	it('uses the local list before the CSMS and honors status and expiry', async () => {
		const harness = createHarness201({ authorizeStatus: 'Invalid' });
		await harness.ready();
		await call(harness, 'auth-1', 'SendLocalList', {
			versionNumber: 1,
			updateType: 'Full',
			localAuthorizationList: [
				authEntry('LOCAL', 'Accepted'),
				authEntry('BLOCKED', 'Blocked'),
				authEntry('EXPIRED', 'Accepted', { cacheExpiryDateTime: '1970-01-01T00:00:01Z' }),
			],
		});
		const started = await harness.simulator.startChargingSession(1, 'local');
		expect(started.ok).toBe(true);
		expect(harness.calls('Authorize')).toHaveLength(0);
		await harness.simulator.stopTransaction(1);
		expect(await harness.simulator.startChargingSession(1, 'BLOCKED')).toMatchObject({
			ok: false,
			reason: 'authorize-rejected',
		});
		expect(await harness.simulator.startChargingSession(1, 'EXPIRED')).toMatchObject({
			ok: false,
			reason: 'authorize-rejected',
		});
		expect(harness.calls('Authorize')).toHaveLength(2);
		expect(await harness.simulator.startChargingSession(1, 'UNKNOWN')).toMatchObject({
			ok: false,
			reason: 'authorize-rejected',
		});
		expect(harness.calls('Authorize')).toHaveLength(3);
	});

	it('enforces an EVSE-restricted local token', async () => {
		const harness = createHarness201();
		await harness.ready();
		await call(harness, 'restrict-1', 'SendLocalList', {
			versionNumber: 1,
			updateType: 'Full',
			localAuthorizationList: [
				{
					idToken: { idToken: 'EVSE2', type: 'ISO14443' },
					idTokenInfo: { status: 'Accepted', evseId: [2] },
				},
			],
		});
		expect(await harness.simulator.startChargingSession(1, 'EVSE2')).toMatchObject({
			ok: false,
			reason: 'authorize-rejected',
		});
		expect((await harness.simulator.startChargingSession(2, 'evse2')).ok).toBe(true);
	});

	it('reserves an EVSE, enforces the token, and consumes the reservation', async () => {
		const harness = createHarness201();
		await harness.ready();
		const created: string[] = [];
		harness.simulator.on('reservation', (event) => {
			created.push(`${event.phase}:${event.reservationId}`);
		});
		const expiry = expiryIn(harness, 60_000);
		expect(
			await call(harness, 'res-1', 'ReserveNow', {
				id: 7,
				expiryDateTime: expiry,
				idToken: { idToken: 'ABC', type: 'ISO14443' },
				evseId: 1,
			}),
		).toEqual({ status: 'Accepted' });
		expect(harness.simulator.state.reservations).toHaveLength(1);
		expect(harness.simulator.getEvse(1)?.status).toBe('Reserved');
		expect(created).toEqual(['created:7']);
		expect(await harness.simulator.startChargingSession(1, 'OTHER')).toMatchObject({
			ok: false,
			reason: 'reserved',
		});
		expect(harness.simulator.getEvse(1)?.transaction).toBeNull();
		const started = await harness.simulator.startChargingSession(1, 'abc');
		expect(started.ok).toBe(true);
		const startedEvent = harness
			.calls('TransactionEvent')
			.map((frame) => frame[3] as Record<string, unknown>)
			.find((payload) => payload['eventType'] === 'Started');
		expect(startedEvent?.['reservationId']).toBe(7);
		expect(harness.simulator.state.reservations).toHaveLength(0);
		expect(harness.simulator.getEvse(1)?.status).toBe('Occupied');
		await harness.simulator.sendTransactionEvent(1, 'Updated', 'Trigger');
		await harness.simulator.stopTransaction(1);
		const later = harness
			.calls('TransactionEvent')
			.map((frame) => frame[3] as Record<string, unknown>)
			.filter((payload) => payload['eventType'] !== 'Started');
		expect(later.length).toBeGreaterThan(0);
		expect(later.every((payload) => payload['reservationId'] === undefined)).toBe(true);
		expect(harness.simulator.getEvse(1)?.status).toBe('Available');
		harness.clock.advance(60_000);
		await flushMicrotasks(40);
		expect(harness.calls('ReservationStatusUpdate')).toHaveLength(0);
	});

	it('restores a reservation when the start fails before Started', async () => {
		const harness = createHarness201();
		await harness.ready();
		await call(harness, 'restore-1', 'ReserveNow', {
			id: 21,
			expiryDateTime: expiryIn(harness, 60_000),
			idToken: { idToken: 'ABC', type: 'ISO14443' },
			evseId: 1,
		});
		const original = harness.transport.send.bind(harness.transport);
		harness.transport.send = (text: string): void => {
			const frame = JSON.parse(text) as unknown[];
			const payload = frame[3] as Record<string, unknown> | undefined;
			if (
				frame[0] === 2 &&
				frame[2] === 'TransactionEvent' &&
				payload?.['eventType'] === 'Started'
			) {
				throw new Error('wire down');
			}
			original(text);
		};
		await expect(harness.simulator.startChargingSession(1, 'ABC')).rejects.toMatchObject({
			code: 'send-failed',
		});
		expect(harness.simulator.state.reservations).toHaveLength(1);
		expect(harness.simulator.getEvse(1)?.status).toBe('Reserved');
		harness.transport.send = original;
	});

	it('does not restore a reservation after Started was delivered', async () => {
		const harness = createHarness201();
		await harness.ready();
		await call(harness, 'nostore-1', 'ReserveNow', {
			id: 22,
			expiryDateTime: expiryIn(harness, 60_000),
			idToken: { idToken: 'ABC', type: 'ISO14443' },
			evseId: 1,
		});
		const original = harness.transport.send.bind(harness.transport);
		harness.transport.send = (text: string): void => {
			const frame = JSON.parse(text) as unknown[];
			const payload = frame[3] as Record<string, unknown> | undefined;
			if (
				frame[0] === 2 &&
				frame[2] === 'TransactionEvent' &&
				payload?.['eventType'] === 'Updated'
			) {
				throw new Error('wire down');
			}
			original(text);
		};
		await expect(harness.simulator.startChargingSession(1, 'ABC')).rejects.toMatchObject({
			code: 'send-failed',
		});
		expect(harness.simulator.state.reservations).toHaveLength(0);
		expect(harness.simulator.getEvse(1)?.status).toBe('Available');
		harness.transport.send = original;
	});

	it('matches a reservation through the local group token', async () => {
		const harness = createHarness201();
		await harness.ready();
		await call(harness, 'group-list', 'SendLocalList', {
			versionNumber: 1,
			updateType: 'Full',
			localAuthorizationList: [
				{
					idToken: { idToken: 'MEMBER', type: 'ISO14443' },
					idTokenInfo: {
						status: 'Accepted',
						groupIdToken: { idToken: 'GROUP', type: 'Central' },
					},
				},
			],
		});
		await call(harness, 'group-res', 'ReserveNow', {
			id: 23,
			expiryDateTime: expiryIn(harness, 60_000),
			idToken: { idToken: 'GROUP', type: 'Central' },
			evseId: 1,
		});
		const started = await harness.simulator.startChargingSession(1, 'member');
		expect(started.ok).toBe(true);
		expect(harness.simulator.state.reservations).toHaveLength(0);
	});

	it('uses the group returned by Authorize for a reservation', async () => {
		const harness = createHarness201({
			authorizeStatus: 'Accepted',
			authorizeGroup: 'GROUP',
		});
		await harness.ready();
		await call(harness, 'csms-group-res', 'ReserveNow', {
			id: 25,
			expiryDateTime: expiryIn(harness, 60_000),
			idToken: { idToken: 'GROUP', type: 'Central' },
			evseId: 1,
		});
		const started = await harness.simulator.startChargingSession(1, 'MEMBER');
		expect(started.ok).toBe(true);
		expect(harness.calls('Authorize')).toHaveLength(1);
		expect(harness.simulator.state.reservations).toHaveLength(0);
	});

	it('aborts RequestStartTransaction when the EVSE changes during the reply', async () => {
		const harness = createHarness201();
		await harness.ready();
		const original = harness.transport.send.bind(harness.transport);
		harness.transport.send = (text: string): void => {
			const frame = JSON.parse(text) as unknown[];
			if (frame[0] === 3 && String(frame[1]).startsWith('remote-')) {
				harness.simulator.setEvseStatus(1, 'Faulted');
			}
			original(text);
		};
		expect(
			await call(harness, 'remote-1', 'RequestStartTransaction', {
				evseId: 1,
				remoteStartId: 1,
				idToken: { idToken: 'A', type: 'ISO14443' },
			}),
		).toMatchObject({ status: 'Accepted' });
		expect(harness.simulator.getEvse(1)?.transaction).toBeNull();
		expect(harness.simulator.getEvse(1)?.status).toBe('Faulted');
		expect(harness.calls('TransactionEvent')).toHaveLength(0);
	});

	it('aborts a pending start when the EVSE becomes unavailable', async () => {
		const harness = createHarness201();
		await harness.ready();
		const original = harness.transport.send.bind(harness.transport);
		harness.transport.send = (text: string): void => {
			const frame = JSON.parse(text) as unknown[];
			if (frame[0] === 2 && frame[2] === 'Authorize') {
				harness.simulator.setEvseStatus(1, 'Unavailable');
			}
			original(text);
		};
		expect(await harness.simulator.startChargingSession(1, 'A')).toMatchObject({
			ok: false,
			reason: 'not-available',
		});
		expect(harness.simulator.getEvse(1)?.transaction).toBeNull();
		expect(harness.simulator.getEvse(1)?.status).toBe('Unavailable');
	});

	it('does not start the same EVSE twice while authorization is pending', async () => {
		const harness = createHarness201();
		await harness.ready();
		const first = harness.simulator.startChargingSession(1, 'A');
		const second = harness.simulator.startChargingSession(1, 'A');
		expect(await second).toMatchObject({ ok: false, reason: 'occupied' });
		expect((await first).ok).toBe(true);
	});

	it('cancels reservations when the public status becomes unusable', async () => {
		const harness = createHarness201();
		await harness.ready();
		await call(harness, 'status-res', 'ReserveNow', {
			id: 24,
			expiryDateTime: expiryIn(harness, 60_000),
			idToken: { idToken: 'A', type: 'ISO14443' },
			evseId: 1,
		});
		await harness.simulator.sendStatusNotification(1, 'Unavailable');
		expect(harness.simulator.state.reservations).toHaveLength(0);
		expect(harness.simulator.getEvse(1)?.status).toBe('Unavailable');
		expect(harness.calls('ReservationStatusUpdate')).toHaveLength(1);
	});

	it('expires reservations and reports the status update', async () => {
		const harness = createHarness201();
		await harness.ready();
		const phases: string[] = [];
		harness.simulator.on('reservation', (event) => {
			phases.push(event.phase);
		});
		await call(harness, 'exp-1', 'ReserveNow', {
			id: 9,
			expiryDateTime: expiryIn(harness, 1000),
			idToken: { idToken: 'ABC', type: 'ISO14443' },
			evseId: 1,
		});
		harness.clock.advance(999);
		await flushMicrotasks(20);
		expect(harness.simulator.state.reservations).toHaveLength(1);
		harness.clock.advance(1);
		await flushMicrotasks(40);
		expect(harness.simulator.state.reservations).toHaveLength(0);
		expect(harness.simulator.getEvse(1)?.status).toBe('Available');
		expect(harness.calls('ReservationStatusUpdate')).toHaveLength(1);
		const update = harness.calls('ReservationStatusUpdate')[0]![3] as Record<string, unknown>;
		expect(update).toEqual({ reservationId: 9, reservationUpdateStatus: 'Expired' });
		expect(phases).toEqual(['created', 'expired']);
	});

	it('cancels reservations and reports removal', async () => {
		const harness = createHarness201();
		await harness.ready();
		await call(harness, 'cancel-1', 'ReserveNow', {
			id: 3,
			expiryDateTime: expiryIn(harness, 60_000),
			idToken: { idToken: 'ABC', type: 'ISO14443' },
			evseId: 1,
		});
		expect(await call(harness, 'cancel-2', 'CancelReservation', { reservationId: 3 })).toEqual({
			status: 'Accepted',
		});
		expect(harness.simulator.state.reservations).toHaveLength(0);
		expect(harness.simulator.getEvse(1)?.status).toBe('Available');
		expect(harness.calls('ReservationStatusUpdate')).toHaveLength(0);
		expect(await call(harness, 'cancel-3', 'CancelReservation', { reservationId: 3 })).toEqual({
			status: 'Rejected',
		});
		expect(
			(
				await errorCall(harness, 'cancel-4', 'CancelReservation', {
					reservationId: 'x',
				})
			).slice(0, 3),
		).toEqual([4, 'cancel-4', 'FormatViolation']);
		harness.clock.advance(120_000);
		await flushMicrotasks(40);
		expect(harness.calls('ReservationStatusUpdate')).toHaveLength(0);
	});

	it('returns every reservation failure status', async () => {
		const harness = createHarness201();
		await harness.ready();
		const expiry = expiryIn(harness, 60_000);
		expect(
			await call(harness, 'res-a', 'ReserveNow', {
				id: 1,
				expiryDateTime: expiry,
				idToken: { idToken: 'A', type: 'ISO14443' },
				evseId: 99,
			}),
		).toEqual({ status: 'Rejected' });
		expect(
			await call(harness, 'res-b', 'ReserveNow', {
				id: 1,
				expiryDateTime: '1970-01-01T00:00:00Z',
				idToken: { idToken: 'A', type: 'ISO14443' },
				evseId: 1,
			}),
		).toEqual({ status: 'Rejected' });
		harness.simulator.setEvseStatus(1, 'Faulted');
		expect(
			await call(harness, 'res-c', 'ReserveNow', {
				id: 1,
				expiryDateTime: expiry,
				idToken: { idToken: 'A', type: 'ISO14443' },
				evseId: 1,
			}),
		).toEqual({ status: 'Faulted' });
		harness.simulator.setEvseStatus(1, 'Unavailable');
		expect(
			await call(harness, 'res-d', 'ReserveNow', {
				id: 1,
				expiryDateTime: expiry,
				idToken: { idToken: 'A', type: 'ISO14443' },
				evseId: 1,
			}),
		).toEqual({ status: 'Unavailable' });
		harness.simulator.setEvseStatus(1, 'Available');
		await harness.simulator.startChargingSession(1, 'A');
		expect(
			await call(harness, 'res-e', 'ReserveNow', {
				id: 2,
				expiryDateTime: expiry,
				idToken: { idToken: 'A', type: 'ISO14443' },
				evseId: 1,
			}),
		).toEqual({ status: 'Occupied' });
		await harness.simulator.stopTransaction(1);
		await call(harness, 'res-f', 'ReserveNow', {
			id: 3,
			expiryDateTime: expiry,
			idToken: { idToken: 'A', type: 'ISO14443' },
			evseId: 1,
		});
		expect(
			await call(harness, 'res-g', 'ReserveNow', {
				id: 4,
				expiryDateTime: expiry,
				idToken: { idToken: 'A', type: 'ISO14443' },
				evseId: 1,
			}),
		).toEqual({ status: 'Occupied' });
		expect(
			await call(harness, 'res-h', 'ReserveNow', {
				id: 3,
				expiryDateTime: expiry,
				idToken: { idToken: 'A', type: 'ISO14443' },
				evseId: 2,
			}),
		).toEqual({ status: 'Accepted' });
		expect(harness.simulator.state.reservations).toHaveLength(1);
		expect(harness.simulator.state.reservations[0]?.evseId).toBe(2);
		expect(harness.simulator.getEvse(1)?.status).toBe('Available');
		expect(harness.simulator.getEvse(2)?.status).toBe('Reserved');
		expect(
			(
				await errorCall(harness, 'res-i', 'ReserveNow', {
					id: 1,
					expiryDateTime: expiry,
				})
			).slice(0, 3),
		).toEqual([4, 'res-i', 'FormatViolation']);
	});

	it('selects the first available EVSE when evseId is omitted', async () => {
		const harness = createHarness201();
		await harness.ready();
		harness.simulator.setEvseStatus(1, 'Unavailable');
		expect(
			await call(harness, 'res-default', 'ReserveNow', {
				id: 1,
				expiryDateTime: expiryIn(harness, 60_000),
				idToken: { idToken: 'A', type: 'ISO14443' },
			}),
		).toEqual({ status: 'Accepted' });
		expect(harness.simulator.state.reservations[0]?.evseId).toBe(2);
	});

	it('classifies a station-wide reservation when no EVSE is selectable', async () => {
		const harness = createHarness201();
		await harness.ready();
		await harness.simulator.startChargingSession(1, 'A');
		await harness.simulator.startChargingSession(2, 'B');
		expect(
			await call(harness, 'sta-1', 'ReserveNow', {
				id: 1,
				expiryDateTime: expiryIn(harness, 60_000),
				idToken: { idToken: 'A', type: 'ISO14443' },
			}),
		).toEqual({ status: 'Occupied' });
		await harness.simulator.stopTransaction(1);
		await harness.simulator.stopTransaction(2);
		harness.simulator.setEvseStatus(1, 'Unavailable');
		harness.simulator.setEvseStatus(2, 'Unavailable');
		expect(
			await call(harness, 'sta-2', 'ReserveNow', {
				id: 1,
				expiryDateTime: expiryIn(harness, 60_000),
				idToken: { idToken: 'A', type: 'ISO14443' },
			}),
		).toEqual({ status: 'Unavailable' });
		harness.simulator.setEvseStatus(1, 'Faulted');
		harness.simulator.setEvseStatus(2, 'Faulted');
		expect(
			await call(harness, 'sta-3', 'ReserveNow', {
				id: 1,
				expiryDateTime: expiryIn(harness, 60_000),
				idToken: { idToken: 'A', type: 'ISO14443' },
			}),
		).toEqual({ status: 'Faulted' });
	});

	it('rejects malformed optional reservation fields', async () => {
		const harness = createHarness201();
		await harness.ready();
		expect(
			(
				await errorCall(harness, 'opt-1', 'ReserveNow', {
					id: 1,
					expiryDateTime: expiryIn(harness, 60_000),
					idToken: { idToken: 'A', type: 'ISO14443' },
					evseId: 'one',
				})
			).slice(0, 3),
		).toEqual([4, 'opt-1', 'FormatViolation']);
		expect(
			(
				await errorCall(harness, 'opt-2', 'ReserveNow', {
					id: 1,
					expiryDateTime: expiryIn(harness, 60_000),
					idToken: { idToken: 'A', type: 'ISO14443' },
					groupIdToken: { idToken: 'G' },
				})
			).slice(0, 3),
		).toEqual([4, 'opt-2', 'FormatViolation']);
		expect(
			(
				await errorCall(harness, 'opt-3', 'SendLocalList', {
					versionNumber: 1,
					updateType: 'Full',
					localAuthorizationList: [
						{
							idToken: { idToken: 'A', type: 'ISO14443' },
							idTokenInfo: { status: 'Accepted', evseId: [] },
						},
					],
				})
			).slice(0, 3),
		).toEqual([4, 'opt-3', 'FormatViolation']);
		expect(
			(
				await errorCall(harness, 'opt-4', 'SendLocalList', {
					versionNumber: 1,
					updateType: 'Full',
					localAuthorizationList: [
						{
							idToken: { idToken: 'A', type: 'ISO14443' },
							idTokenInfo: { status: 'Accepted', cacheExpiryDateTime: 'not-a-date' },
						},
					],
				})
			).slice(0, 3),
		).toEqual([4, 'opt-4', 'FormatViolation']);
	});

	it('does not restore a reserved status after an inoperative expiry', async () => {
		const harness = createHarness201();
		await harness.ready();
		await call(harness, 'inop-res', 'ReserveNow', {
			id: 5,
			expiryDateTime: expiryIn(harness, 1000),
			idToken: { idToken: 'A', type: 'ISO14443' },
			evseId: 1,
		});
		await call(harness, 'inop-avail', 'ChangeAvailability', {
			operationalStatus: 'Inoperative',
			evse: { id: 1 },
		});
		expect(harness.simulator.state.reservations).toHaveLength(0);
		expect(harness.simulator.getEvse(1)?.status).toBe('Unavailable');
		expect(harness.calls('ReservationStatusUpdate')).toHaveLength(1);
		harness.clock.advance(1000);
		await flushMicrotasks(40);
		expect(harness.simulator.getEvse(1)?.operational).toBe('Inoperative');
		expect(harness.simulator.getEvse(1)?.status).toBe('Unavailable');
		expect(harness.calls('ReservationStatusUpdate')).toHaveLength(1);
		await call(harness, 'inop-op', 'ChangeAvailability', {
			operationalStatus: 'Operative',
			evse: { id: 1 },
		});
		expect(harness.simulator.getEvse(1)?.status).toBe('Available');
	});

	it('caps long reservation timers and rearms them', async () => {
		const harness = createHarness201();
		await harness.ready();
		await call(harness, 'long-1', 'ReserveNow', {
			id: 11,
			expiryDateTime: expiryIn(harness, MAX_TIMER_DELAY + 1000),
			idToken: { idToken: 'A', type: 'ISO14443' },
			evseId: 1,
		});
		harness.clock.advance(MAX_TIMER_DELAY);
		await flushMicrotasks(20);
		expect(harness.simulator.state.reservations).toHaveLength(1);
		harness.clock.advance(1000);
		await flushMicrotasks(40);
		expect(harness.simulator.state.reservations).toHaveLength(0);
		expect(harness.calls('ReservationStatusUpdate')).toHaveLength(1);
	});

	it('queues reservation traffic before boot', async () => {
		const harness = createHarness201({
			bootStatus: 'Pending',
			boot: { auto: true, required: true, retryOnPending: false },
		});
		await harness.ready();
		expect(
			await call(harness, 'pre-res', 'ReserveNow', {
				id: 12,
				expiryDateTime: expiryIn(harness, 1000),
				idToken: { idToken: 'A', type: 'ISO14443' },
				evseId: 1,
			}),
		).toEqual({ status: 'Accepted' });
		expect(harness.calls('StatusNotification')).toHaveLength(0);
		expect(
			harness.simulator.getQueue().some((entry) => entry.action === 'StatusNotification'),
		).toBe(true);
		harness.clock.advance(1000);
		await flushMicrotasks(40);
		expect(
			harness.simulator.getQueue().some((entry) => entry.action === 'ReservationStatusUpdate'),
		).toBe(true);
	});

	it('uses the reject mode for local authorization commands', async () => {
		const harness = createHarness201();
		await harness.ready();
		harness.simulator.setInboundResponseMode('reject');
		expect(
			await call(harness, 'rej-1', 'SendLocalList', {
				versionNumber: 1,
				updateType: 'Full',
			}),
		).toEqual({ status: 'Rejected' });
		expect(
			await call(harness, 'rej-2', 'ReserveNow', {
				id: 1,
				expiryDateTime: expiryIn(harness, 60_000),
				idToken: { idToken: 'A', type: 'ISO14443' },
			}),
		).toEqual({ status: 'Rejected' });
		expect(await call(harness, 'rej-3', 'CancelReservation', { reservationId: 1 })).toEqual({
			status: 'Rejected',
		});
	});
});
