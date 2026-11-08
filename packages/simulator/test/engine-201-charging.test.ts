// SPDX-License-Identifier: Apache-2.0
// SPDX-FileCopyrightText: 2026 Rodolfo Carrillo

import { describe, expect, it } from 'vitest';

import type { JsonObject } from '@ocpptools/core';

import { createHarness201, framePayload, type Harness201 } from './helpers/simulator-201.js';

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

function chargingProfile(overrides: Record<string, unknown> = {}): Record<string, unknown> {
	return {
		id: 1,
		stackLevel: 1,
		chargingProfilePurpose: 'TxDefaultProfile',
		chargingProfileKind: 'Absolute',
		chargingSchedule: [
			{
				id: 1,
				chargingRateUnit: 'W',
				chargingSchedulePeriod: [
					{ startPeriod: 0, limit: 11000 },
					{ startPeriod: 3600, limit: 7000 },
				],
			},
		],
		...overrides,
	};
}

describe('Simulator201 charging profiles', () => {
	it('stores, replaces, and validates charging profiles', async () => {
		const harness = createHarness201();
		await harness.ready();
		expect(
			await call(harness, 'prof-1', 'SetChargingProfile', {
				evseId: 1,
				chargingProfile: chargingProfile(),
			}),
		).toEqual({ status: 'Accepted' });
		expect(harness.simulator.state.charging.profiles).toHaveLength(1);
		await call(harness, 'prof-2', 'SetChargingProfile', {
			evseId: 1,
			chargingProfile: chargingProfile({ stackLevel: 2 }),
		});
		expect(harness.simulator.state.charging.profiles).toHaveLength(1);
		expect(harness.simulator.state.charging.profiles[0]?.profile['stackLevel']).toBe(2);
		expect(
			await call(harness, 'prof-3', 'SetChargingProfile', {
				evseId: 2,
				chargingProfile: chargingProfile({ id: 2 }),
			}),
		).toEqual({ status: 'Accepted' });
		await call(harness, 'prof-3b', 'SetChargingProfile', {
			evseId: 2,
			chargingProfile: chargingProfile({ id: 3, stackLevel: 2 }),
		});
		expect(harness.simulator.state.charging.profiles).toHaveLength(3);
		await call(harness, 'prof-3c', 'SetChargingProfile', {
			evseId: 2,
			chargingProfile: chargingProfile({ id: 4, stackLevel: 2 }),
		});
		expect(harness.simulator.state.charging.profiles).toHaveLength(3);
		const evse2Ids = harness.simulator.state.charging.profiles
			.filter((item) => item.evseId === 2)
			.map((item) => item.profile['id']);
		expect(evse2Ids).toContain(4);
		expect(evse2Ids).not.toContain(3);
		await call(harness, 'prof-3d', 'SetChargingProfile', {
			evseId: 2,
			chargingProfile: chargingProfile({ id: 1 }),
		});
		expect(harness.simulator.state.charging.profiles.some((item) => item.evseId === 1)).toBe(false);
		expect(
			harness.simulator.state.charging.profiles.some(
				(item) => item.evseId === 2 && item.profile['id'] === 1,
			),
		).toBe(true);
		expect(
			await call(harness, 'prof-4', 'SetChargingProfile', {
				evseId: 99,
				chargingProfile: chargingProfile(),
			}),
		).toEqual({ status: 'Rejected' });
		expect(
			(
				await errorCall(harness, 'prof-5', 'SetChargingProfile', {
					evseId: 1,
					chargingProfile: { id: 1 },
				})
			).slice(0, 3),
		).toEqual([4, 'prof-5', 'FormatViolation']);
		expect(
			(
				await errorCall(harness, 'prof-6', 'SetChargingProfile', {
					evseId: 1,
					chargingProfile: chargingProfile({
						chargingSchedule: [
							{
								id: 1,
								chargingRateUnit: 'W',
								chargingSchedulePeriod: [{ startPeriod: 0 }],
							},
						],
					}),
				})
			).slice(0, 3),
		).toEqual([4, 'prof-6', 'FormatViolation']);
		expect(
			await call(harness, 'prof-7', 'SetChargingProfile', {
				evseId: 1,
				chargingProfile: chargingProfile({
					id: 20,
					chargingProfilePurpose: 'TxProfile',
				}),
			}),
		).toEqual({ status: 'Rejected' });
	});

	it('clears profiles by id, criteria, or all', async () => {
		const harness = createHarness201();
		await harness.ready();
		await call(harness, 'clear-prof-setup', 'SetChargingProfile', {
			evseId: 1,
			chargingProfile: chargingProfile(),
		});
		await call(harness, 'clear-prof-setup-2', 'SetChargingProfile', {
			evseId: 2,
			chargingProfile: chargingProfile({
				id: 2,
				stackLevel: 5,
				chargingProfilePurpose: 'ChargingStationMaxProfile',
			}),
		});
		expect(
			await call(harness, 'clear-prof-1', 'ClearChargingProfile', { chargingProfileId: 99 }),
		).toEqual({ status: 'Unknown' });
		expect(
			await call(harness, 'clear-prof-2', 'ClearChargingProfile', { chargingProfileId: 1 }),
		).toEqual({ status: 'Accepted' });
		expect(harness.calls('ClearedChargingLimit')).toHaveLength(0);
		expect(
			await call(harness, 'clear-prof-3', 'ClearChargingProfile', {
				chargingProfileCriteria: { chargingProfilePurpose: 'ChargingStationMaxProfile' },
			}),
		).toEqual({ status: 'Accepted' });
		expect(harness.simulator.state.charging.profiles).toHaveLength(0);
		expect(await call(harness, 'clear-prof-4', 'ClearChargingProfile', {})).toEqual({
			status: 'Unknown',
		});
		expect(
			(
				await errorCall(harness, 'clear-prof-5', 'ClearChargingProfile', {
					chargingProfileCriteria: { chargingProfilePurpose: 'Bogus' },
				})
			).slice(0, 3),
		).toEqual([4, 'clear-prof-5', 'FormatViolation']);
	});

	it('supports station-wide profiles with evseId zero', async () => {
		const harness = createHarness201();
		await harness.ready();
		expect(
			await call(harness, 'zero-1', 'SetChargingProfile', {
				evseId: 0,
				chargingProfile: chargingProfile({ id: 9, stackLevel: 0 }),
			}),
		).toEqual({ status: 'Accepted' });
		expect(harness.simulator.state.charging.profiles[0]?.evseId).toBe(0);
		expect(
			await call(harness, 'zero-2', 'GetChargingProfiles', {
				requestId: 1,
				evseId: 0,
				chargingProfile: {},
			}),
		).toEqual({ status: 'Accepted' });
		const report = harness
			.calls('ReportChargingProfiles')
			.map((frame) => frame[3] as Record<string, unknown>)[0];
		expect(report?.['evseId']).toBe(0);
		expect(
			await call(harness, 'zero-3', 'GetCompositeSchedule', { evseId: 0, duration: 60 }),
		).toMatchObject({ status: 'Accepted' });
		expect(
			await call(harness, 'zero-4', 'GetCompositeSchedule', { evseId: 1, duration: 60 }),
		).toMatchObject({
			status: 'Accepted',
			schedule: { chargingSchedulePeriod: [{ startPeriod: 0, limit: 11000 }] },
		});
	});

	it('clears profiles with AND criteria and evse filtering', async () => {
		const harness = createHarness201();
		await harness.ready();
		await call(harness, 'and-setup-1', 'SetChargingProfile', {
			evseId: 1,
			chargingProfile: chargingProfile(),
		});
		await call(harness, 'and-setup-2', 'SetChargingProfile', {
			evseId: 2,
			chargingProfile: chargingProfile({ id: 2 }),
		});
		expect(
			await call(harness, 'and-1', 'ClearChargingProfile', {
				chargingProfileCriteria: { evseId: 1, stackLevel: 9 },
			}),
		).toEqual({ status: 'Unknown' });
		expect(harness.simulator.state.charging.profiles).toHaveLength(2);
		expect(
			await call(harness, 'and-2', 'ClearChargingProfile', {
				chargingProfileCriteria: { evseId: 1 },
			}),
		).toEqual({ status: 'Accepted' });
		expect(harness.simulator.state.charging.profiles).toHaveLength(1);
		expect(harness.simulator.state.charging.profiles[0]?.evseId).toBe(2);
		expect(
			(
				await errorCall(harness, 'and-3', 'ClearChargingProfile', {
					chargingProfileCriteria: { evseId: 'one' },
				})
			).slice(0, 3),
		).toEqual([4, 'and-3', 'FormatViolation']);
		expect(
			(
				await errorCall(harness, 'and-4', 'ClearChargingProfile', {
					chargingProfileCriteria: { stacklevel: 1 },
				})
			).slice(0, 3),
		).toEqual([4, 'and-4', 'FormatViolation']);
		expect(harness.simulator.state.charging.profiles).toHaveLength(1);
	});

	it('reports charging profiles with filters', async () => {
		const harness = createHarness201();
		await harness.ready();
		expect(
			await call(harness, 'getprof-1', 'GetChargingProfiles', {
				requestId: 1,
				chargingProfile: {},
			}),
		).toEqual({ status: 'NoProfiles' });
		await call(harness, 'getprof-setup', 'SetChargingProfile', {
			evseId: 1,
			chargingProfile: chargingProfile(),
		});
		await call(harness, 'getprof-setup-2', 'SetChargingProfile', {
			evseId: 2,
			chargingProfile: chargingProfile({ id: 2, stackLevel: 4 }),
		});
		expect(
			await call(harness, 'getprof-2', 'GetChargingProfiles', {
				requestId: 2,
				chargingProfile: {},
			}),
		).toEqual({ status: 'Accepted' });
		const reports = harness
			.calls('ReportChargingProfiles')
			.map((frame) => frame[3] as Record<string, unknown>);
		expect(reports).toHaveLength(2);
		expect(reports[0]).toMatchObject({
			requestId: 2,
			chargingLimitSource: 'CSO',
			tbc: true,
		});
		expect(reports[1]).toMatchObject({ tbc: false });
		await call(harness, 'getprof-3', 'GetChargingProfiles', {
			requestId: 3,
			chargingProfile: { stackLevel: 4 },
		});
		expect(
			await call(harness, 'getprof-4', 'GetChargingProfiles', {
				requestId: 4,
				evseId: 1,
				chargingProfile: { chargingProfileId: [99] },
			}),
		).toEqual({ status: 'NoProfiles' });
		expect(
			await call(harness, 'getprof-4b', 'GetChargingProfiles', {
				requestId: 5,
				chargingProfile: { chargingLimitSource: ['EMS'] },
			}),
		).toEqual({ status: 'NoProfiles' });
		expect(
			await call(harness, 'getprof-4c', 'GetChargingProfiles', {
				requestId: 6,
				chargingProfile: { chargingLimitSource: ['CSO'] },
			}),
		).toEqual({ status: 'Accepted' });
		expect(
			(
				await errorCall(harness, 'getprof-5', 'GetChargingProfiles', {
					requestId: 1,
				})
			).slice(0, 3),
		).toEqual([4, 'getprof-5', 'FormatViolation']);
		expect(
			(
				await errorCall(harness, 'getprof-6', 'GetChargingProfiles', {
					requestId: 1,
					evseId: 'one',
					chargingProfile: {},
				})
			).slice(0, 3),
		).toEqual([4, 'getprof-6', 'FormatViolation']);
	});

	it('builds a composite schedule from the highest stack profile', async () => {
		const harness = createHarness201();
		await harness.ready();
		const defaultSchedule = await call(harness, 'comp-1', 'GetCompositeSchedule', {
			evseId: 1,
			duration: 3600,
		});
		expect(defaultSchedule['status']).toBe('Accepted');
		expect(defaultSchedule['schedule']).toMatchObject({
			evseId: 1,
			duration: 3600,
			chargingRateUnit: 'W',
			chargingSchedulePeriod: [{ startPeriod: 0, limit: 11000 }],
		});
		await call(harness, 'comp-setup', 'SetChargingProfile', {
			evseId: 1,
			chargingProfile: chargingProfile({ stackLevel: 2 }),
		});
		const accepted = await call(harness, 'comp-2', 'GetCompositeSchedule', {
			evseId: 1,
			duration: 7200,
		});
		expect(accepted).toMatchObject({
			status: 'Accepted',
			schedule: {
				chargingRateUnit: 'W',
				chargingSchedulePeriod: [
					{ startPeriod: 0, limit: 11000 },
					{ startPeriod: 3600, limit: 7000 },
				],
			},
		});
		expect(
			await call(harness, 'comp-3', 'GetCompositeSchedule', {
				evseId: 1,
				duration: 3600,
				chargingRateUnit: 'A',
			}),
		).toMatchObject({
			schedule: {
				chargingRateUnit: 'A',
				chargingSchedulePeriod: [{ startPeriod: 0, limit: 15.94 }],
			},
		});
		await call(harness, 'comp-4', 'GetCompositeSchedule', { evseId: 99, duration: 3600 });
		const started = await harness.simulator.startChargingSession(1, 'A');
		await call(harness, 'comp-profile', 'SetChargingProfile', {
			evseId: 1,
			chargingProfile: chargingProfile({
				id: 10,
				stackLevel: 9,
				chargingProfilePurpose: 'TxProfile',
				transactionId: started.transactionId,
				chargingSchedule: [
					{
						id: 1,
						chargingRateUnit: 'W',
						chargingSchedulePeriod: [{ startPeriod: 0, limit: 11000 }],
					},
				],
			}),
		});
		expect(
			await call(harness, 'comp-5a', 'GetCompositeSchedule', { evseId: 1, duration: 3600 }),
		).toMatchObject({
			schedule: { chargingSchedulePeriod: [{ startPeriod: 0, limit: 11000 }] },
		});
		expect(
			(
				await errorCall(harness, 'comp-5', 'GetCompositeSchedule', {
					evseId: 1,
					duration: 0,
				})
			).slice(0, 3),
		).toEqual([4, 'comp-5', 'FormatViolation']);
		expect(
			(
				await errorCall(harness, 'comp-6', 'GetCompositeSchedule', {
					evseId: 1,
					duration: 3600,
					chargingRateUnit: 'kW',
				})
			).slice(0, 3),
		).toEqual([4, 'comp-6', 'FormatViolation']);
	});

	it('sends charging and EV notifications', async () => {
		const harness = createHarness201();
		await harness.ready();
		await harness.simulator.sendNotifyChargingLimit('EMS', 1);
		await harness.simulator.sendClearedChargingLimit('SO');
		await harness.simulator.sendNotifyEVChargingNeeds(1, 'DC', { evMaxCurrent: 200 });
		await harness.simulator.sendNotifyEVChargingSchedule(1, {
			id: 1,
			chargingRateUnit: 'W',
			chargingSchedulePeriod: [{ startPeriod: 0, limit: 50000 }],
		});
		const notify = harness.calls('NotifyChargingLimit')[0]![3] as Record<string, unknown>;
		expect(notify).toEqual({
			chargingLimit: { chargingLimitSource: 'EMS' },
			evseId: 1,
		});
		const cleared = harness.calls('ClearedChargingLimit')[0]![3] as Record<string, unknown>;
		expect(cleared).toEqual({ chargingLimitSource: 'SO' });
		const needs = harness.calls('NotifyEVChargingNeeds')[0]![3] as Record<string, unknown>;
		expect(needs).toMatchObject({
			evseId: 1,
			chargingNeeds: { requestedEnergyTransfer: 'DC', evMaxCurrent: 200 },
		});
		const schedule = harness.calls('NotifyEVChargingSchedule')[0]![3] as Record<string, unknown>;
		expect(schedule).toMatchObject({ evseId: 1, chargingSchedule: { id: 1 } });
	});

	it('uses the reject mode for charging commands', async () => {
		const harness = createHarness201();
		await harness.ready();
		harness.simulator.setInboundResponseMode('reject');
		expect(
			await call(harness, 'crej-1', 'SetChargingProfile', {
				evseId: 1,
				chargingProfile: chargingProfile(),
			}),
		).toEqual({ status: 'Rejected' });
		expect(await call(harness, 'crej-2', 'ClearChargingProfile', {})).toEqual({
			status: 'Unknown',
		});
		expect(
			await call(harness, 'crej-3', 'GetChargingProfiles', {
				requestId: 1,
				chargingProfile: {},
			}),
		).toEqual({ status: 'NoProfiles' });
		expect(
			await call(harness, 'crej-4', 'GetCompositeSchedule', { evseId: 1, duration: 60 }),
		).toEqual({ status: 'Rejected' });
	});

	it('queues profile reports before boot', async () => {
		const harness = createHarness201({
			bootStatus: 'Pending',
			boot: { auto: true, required: true, retryOnPending: false },
		});
		await harness.ready();
		await call(harness, 'pre-prof-setup', 'SetChargingProfile', {
			evseId: 1,
			chargingProfile: chargingProfile(),
		});
		expect(
			await call(harness, 'pre-prof', 'GetChargingProfiles', {
				requestId: 1,
				chargingProfile: {},
			}),
		).toEqual({ status: 'Accepted' });
		expect(harness.calls('ReportChargingProfiles')).toHaveLength(0);
		expect(
			harness.simulator.getQueue().some((entry) => entry.action === 'ReportChargingProfiles'),
		).toBe(true);
	});

	it('sends a profile that is still schema-shaped', async () => {
		const harness = createHarness201();
		await harness.ready();
		const profile: JsonObject = chargingProfile() as JsonObject;
		await call(harness, 'shape-1', 'SetChargingProfile', {
			evseId: 1,
			chargingProfile: profile,
		});
		expect(harness.simulator.state.charging.profiles[0]?.profile['id']).toBe(1);
	});
});
