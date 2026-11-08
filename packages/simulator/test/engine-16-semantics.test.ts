// SPDX-License-Identifier: Apache-2.0
// SPDX-FileCopyrightText: 2026 Rodolfo Carrillo

import { describe, expect, it } from 'vitest';

import { Simulator16 } from '../src/1.6.js';
import { FakeClock, flushMicrotasks } from './helpers/fake-clock.js';
import { FakeTransportFactory, type FakeTransport } from './helpers/fake-transport.js';

function autoRespond(transport: FakeTransport): void {
	const send = transport.send.bind(transport);
	transport.send = (text: string): void => {
		send(text);
		const frame = JSON.parse(text) as unknown[];
		if (frame[0] !== 2) return;
		const [, id, action] = frame as [number, string, string];
		const responses: Record<string, unknown> = {
			BootNotification: {
				status: 'Accepted',
				currentTime: '2026-01-01T00:00:00Z',
				interval: 60,
			},
			Authorize: { idTagInfo: { status: 'Accepted' } },
			StartTransaction: { transactionId: 5, idTagInfo: { status: 'Accepted' } },
			StopTransaction: { idTagInfo: { status: 'Accepted' } },
			Heartbeat: { currentTime: '2026-01-01T00:00:00Z' },
		};
		transport.receive(JSON.stringify([3, id, responses[action] ?? {}]));
	};
}

async function ready(options: { boot?: boolean; connectors?: number } = {}) {
	const clock = new FakeClock();
	const factory = new FakeTransportFactory();
	let sequence = 0;
	const simulator = new Simulator16({
		url: 'ws://localhost/CP16',
		transport: factory.factory,
		clock,
		messageIds: () => `id-${++sequence}`,
		boot:
			options.boot === false ? { auto: false, required: true } : { auto: false, required: false },
		station: {
			id: 'CP16',
			vendor: 'Acme',
			model: 'AC-7',
			firmwareVersion: '1.0.0',
			connectorCount: options.connectors ?? 1,
			defaultIdTag: 'TAG',
		},
	});
	simulator.connect();
	const transport = factory.transports[0]!;
	autoRespond(transport);
	transport.open();
	await flushMicrotasks(60);
	return { clock, factory, simulator, transport };
}

describe('OCPP 1.6 semantics', () => {
	it('stores, replaces, clears, and composites charging profiles', async () => {
		const { simulator, transport } = await ready();
		transport.sent.length = 0;
		const profile = {
			chargingProfileId: 1,
			stackLevel: 2,
			chargingProfilePurpose: 'TxDefaultProfile',
			chargingProfileKind: 'Absolute',
			chargingSchedule: {
				chargingRateUnit: 'W',
				duration: 3600,
				chargingSchedulePeriod: [
					{ startPeriod: 0, limit: 11000 },
					{ startPeriod: 1800, limit: 7000 },
				],
			},
		};
		simulator.rpc.handleText(
			JSON.stringify([
				2,
				'set-1',
				'SetChargingProfile',
				{ connectorId: 1, csChargingProfiles: profile },
			]),
		);
		simulator.rpc.handleText(
			JSON.stringify([
				2,
				'set-2',
				'SetChargingProfile',
				{ connectorId: 1, csChargingProfiles: { ...profile, stackLevel: 3 } },
			]),
		);
		await flushMicrotasks(30);
		expect(simulator.chargingProfiles.list()).toHaveLength(1);
		expect(simulator.chargingProfiles.list()[0]).toMatchObject({
			id: 1,
			stackLevel: 3,
			periods: [
				{ startPeriod: 0, limit: 11000 },
				{ startPeriod: 1800, limit: 7000 },
			],
		});
		simulator.rpc.handleText(
			JSON.stringify([2, 'comp-1', 'GetCompositeSchedule', { connectorId: 1, duration: 3600 }]),
		);
		await flushMicrotasks(30);
		const compositeText = transport.sent.find((text) => text.startsWith('[3,"comp-1"'));
		const composite =
			compositeText === undefined ? undefined : (JSON.parse(compositeText) as unknown[]);
		expect(composite?.[2]).toMatchObject({
			status: 'Accepted',
			chargingSchedule: {
				chargingRateUnit: 'W',
				chargingSchedulePeriod: [
					{ startPeriod: 0, limit: 11000 },
					{ startPeriod: 1800, limit: 7000 },
				],
			},
		});
		simulator.rpc.handleText(JSON.stringify([2, 'clear-1', 'ClearChargingProfile', { id: 1 }]));
		simulator.rpc.handleText(JSON.stringify([2, 'clear-2', 'ClearChargingProfile', { id: 1 }]));
		await flushMicrotasks(30);
		expect(simulator.chargingProfiles.list()).toHaveLength(0);
		expect(transport.sent.some((text) => text.includes('[3,"clear-2",{"status":"Unknown"}]'))).toBe(
			true,
		);
		simulator.dispose();
	});

	it('rejects inadmissible charging profiles', async () => {
		const { simulator, transport } = await ready();
		transport.sent.length = 0;
		const cases: Array<[string, Record<string, unknown>]> = [
			[
				'bad-purpose',
				{
					chargingProfileId: 1,
					stackLevel: 1,
					chargingProfilePurpose: 'Bogus',
					chargingProfileKind: 'Absolute',
					chargingSchedule: {
						chargingRateUnit: 'W',
						duration: 3600,
						chargingSchedulePeriod: [{ startPeriod: 0, limit: 1000 }],
					},
				},
			],
			[
				'bad-kind',
				{
					chargingProfileId: 2,
					stackLevel: 1,
					chargingProfilePurpose: 'TxDefaultProfile',
					chargingProfileKind: 'Bogus',
					chargingSchedule: {
						chargingRateUnit: 'W',
						duration: 3600,
						chargingSchedulePeriod: [{ startPeriod: 0, limit: 1000 }],
					},
				},
			],
			[
				'max-wrong-connector',
				{
					chargingProfileId: 3,
					stackLevel: 1,
					chargingProfilePurpose: 'ChargePointMaxProfile',
					chargingProfileKind: 'Absolute',
					chargingSchedule: {
						chargingRateUnit: 'W',
						duration: 3600,
						chargingSchedulePeriod: [{ startPeriod: 0, limit: 1000 }],
					},
				},
			],
			[
				'tx-no-transaction',
				{
					chargingProfileId: 4,
					stackLevel: 1,
					chargingProfilePurpose: 'TxProfile',
					chargingProfileKind: 'Absolute',
					chargingSchedule: {
						chargingRateUnit: 'W',
						duration: 3600,
						chargingSchedulePeriod: [{ startPeriod: 0, limit: 1000 }],
					},
				},
			],
			[
				'fractional-start',
				{
					chargingProfileId: 5,
					stackLevel: 1,
					chargingProfilePurpose: 'TxDefaultProfile',
					chargingProfileKind: 'Absolute',
					chargingSchedule: {
						chargingRateUnit: 'W',
						duration: 3600,
						chargingSchedulePeriod: [{ startPeriod: 0.5, limit: 1000 }],
					},
				},
			],
		];
		for (const [id, profile] of cases) {
			simulator.rpc.handleText(
				JSON.stringify([
					2,
					id,
					'SetChargingProfile',
					{ connectorId: 1, csChargingProfiles: profile },
				]),
			);
		}
		await flushMicrotasks(30);
		for (const [id] of cases) {
			expect(
				transport.sent.some((text) => text.includes(`[3,"${id}",{"status":"Rejected"}]`)),
			).toBe(true);
		}
		expect(simulator.chargingProfiles.list()).toHaveLength(0);
		simulator.dispose();
	});

	it('merges the station maximum with the transaction default', async () => {
		const { simulator, transport } = await ready();
		transport.sent.length = 0;
		const set = (id: number, connectorId: number, purpose: string, limit: number): void => {
			simulator.rpc.handleText(
				JSON.stringify([
					2,
					`set-${id}`,
					'SetChargingProfile',
					{
						connectorId,
						csChargingProfiles: {
							chargingProfileId: id,
							stackLevel: 1,
							chargingProfilePurpose: purpose,
							chargingProfileKind: 'Absolute',
							chargingSchedule: {
								chargingRateUnit: 'W',
								duration: 3600,
								chargingSchedulePeriod: [{ startPeriod: 0, limit }],
							},
						},
					},
				]),
			);
		};
		set(10, 0, 'ChargePointMaxProfile', 7000);
		set(11, 1, 'TxDefaultProfile', 11000);
		simulator.rpc.handleText(
			'[2,"comp-max","GetCompositeSchedule",{"connectorId":1,"duration":3600}]',
		);
		await flushMicrotasks(30);
		const reply = transport.sent.find((text) => text.startsWith('[3,"comp-max"'));
		const payload = JSON.parse(reply!) as unknown[];
		expect(payload[2]).toMatchObject({
			status: 'Accepted',
			chargingSchedule: {
				chargingSchedulePeriod: [{ startPeriod: 0, limit: 7000 }],
			},
		});
		simulator.dispose();
	});

	it('preserves phase metadata and rounds A limits', async () => {
		const { simulator } = await ready();
		const profile = {
			chargingProfileId: 20,
			stackLevel: 1,
			chargingProfilePurpose: 'TxDefaultProfile',
			chargingProfileKind: 'Absolute',
			chargingSchedule: {
				chargingRateUnit: 'A',
				duration: 3600,
				chargingSchedulePeriod: [{ startPeriod: 0, limit: 16, numberPhases: 1 }],
			},
		};
		simulator.rpc.handleText(
			JSON.stringify([
				2,
				'set-a',
				'SetChargingProfile',
				{ connectorId: 1, csChargingProfiles: profile },
			]),
		);
		simulator.rpc.handleText(
			'[2,"comp-a","GetCompositeSchedule",{"connectorId":1,"duration":3600,"chargingRateUnit":"A"}]',
		);
		await flushMicrotasks(30);
		expect(simulator.state.compositeSchedules['1']).toMatchObject({
			chargingSchedulePeriod: [{ startPeriod: 0, limit: 16, numberPhases: 1 }],
		});
		simulator.rpc.handleText(
			'[2,"comp-w","GetCompositeSchedule",{"connectorId":1,"duration":3600,"chargingRateUnit":"W"}]',
		);
		await flushMicrotasks(30);
		expect(simulator.state.compositeSchedules['1']).toMatchObject({
			chargingSchedulePeriod: [{ startPeriod: 0, limit: 3680 }],
		});

		simulator.rpc.handleText(
			JSON.stringify([
				2,
				'set-w',
				'SetChargingProfile',
				{
					connectorId: 1,
					csChargingProfiles: {
						chargingProfileId: 21,
						stackLevel: 2,
						chargingProfilePurpose: 'TxDefaultProfile',
						chargingProfileKind: 'Absolute',
						chargingSchedule: {
							chargingRateUnit: 'W',
							duration: 3600,
							chargingSchedulePeriod: [{ startPeriod: 0, limit: 11000 }],
						},
					},
				},
			]),
		);
		simulator.rpc.handleText(
			'[2,"comp-w2","GetCompositeSchedule",{"connectorId":1,"duration":3600,"chargingRateUnit":"A"}]',
		);
		await flushMicrotasks(30);
		expect(simulator.state.compositeSchedules['1']).toMatchObject({
			chargingSchedulePeriod: [{ startPeriod: 0, limit: 15.9 }],
		});
		simulator.dispose();
	});
	it('honors profile validity and schedule windows in the composite', async () => {
		const { clock, simulator } = await ready();
		const set = (id: number, extra: Record<string, unknown>): void => {
			simulator.rpc.handleText(
				JSON.stringify([
					2,
					`win-${id}`,
					'SetChargingProfile',
					{
						connectorId: 1,
						csChargingProfiles: {
							chargingProfileId: id,
							stackLevel: 1,
							chargingProfilePurpose: 'TxDefaultProfile',
							chargingProfileKind: 'Absolute',
							...extra,
							chargingSchedule: {
								chargingRateUnit: 'W',
								duration: 600,
								chargingSchedulePeriod: [{ startPeriod: 0, limit: 4000 }],
							},
						},
					},
				]),
			);
		};
		set(30, {});
		simulator.rpc.handleText(
			'[2,"win-duration","GetCompositeSchedule",{"connectorId":1,"duration":3600}]',
		);
		await flushMicrotasks(30);
		expect(simulator.state.compositeSchedules['1']).toMatchObject({
			chargingSchedulePeriod: [
				{ startPeriod: 0, limit: 4000 },
				{ startPeriod: 600, limit: 32000 },
			],
		});

		clock.advance(1000);
		simulator.rpc.handleText('[2,"clear-window","ClearChargingProfile",{}]');
		set(31, { validFrom: '1970-01-01T00:10:00Z' });
		simulator.rpc.handleText(
			'[2,"win-valid","GetCompositeSchedule",{"connectorId":1,"duration":3600}]',
		);
		await flushMicrotasks(30);
		expect(simulator.state.compositeSchedules['1']).toMatchObject({
			chargingSchedulePeriod: [
				{ startPeriod: 0, limit: 32000 },
				{ startPeriod: 599, limit: 4000 },
				{ startPeriod: 600, limit: 32000 },
			],
		});
		simulator.dispose();
	});

	it('falls back by time window, stack, and connector specificity', async () => {
		const { clock, simulator } = await ready({ connectors: 2 });
		const set = (
			id: number,
			connectorId: number,
			purpose: string,
			stackLevel: number,
			duration: number,
			limit: number,
			extra: Record<string, unknown> = {},
		): void => {
			simulator.rpc.handleText(
				JSON.stringify([
					2,
					`fb-${id}`,
					'SetChargingProfile',
					{
						connectorId,
						csChargingProfiles: {
							chargingProfileId: id,
							stackLevel,
							chargingProfilePurpose: purpose,
							chargingProfileKind: 'Absolute',
							chargingSchedule: {
								chargingRateUnit: 'W',
								duration,
								...extra,
								chargingSchedulePeriod: [{ startPeriod: 0, limit }],
							},
						},
					},
				]),
			);
		};
		clock.advance(1800_000);
		set(50, 1, 'TxDefaultProfile', 1, 3600, 11000, {
			startSchedule: '1970-01-01T00:00:00Z',
		});
		simulator.rpc.handleText(
			'[2,"fb-past","GetCompositeSchedule",{"connectorId":1,"duration":3600}]',
		);
		await flushMicrotasks(30);
		expect(simulator.state.compositeSchedules['1']).toMatchObject({
			chargingSchedulePeriod: [
				{ startPeriod: 0, limit: 11000 },
				{ startPeriod: 1800, limit: 32000 },
			],
		});

		simulator.rpc.handleText('[2,"fb-clear","ClearChargingProfile",{}]');
		set(51, 1, 'TxDefaultProfile', 5, 600, 7000);
		set(52, 1, 'TxDefaultProfile', 1, 3600, 4000);
		simulator.rpc.handleText(
			'[2,"fb-stack","GetCompositeSchedule",{"connectorId":1,"duration":3600}]',
		);
		await flushMicrotasks(30);
		expect(simulator.state.compositeSchedules['1']).toMatchObject({
			chargingSchedulePeriod: [
				{ startPeriod: 0, limit: 7000 },
				{ startPeriod: 600, limit: 4000 },
			],
		});

		simulator.rpc.handleText('[2,"fb-clear2","ClearChargingProfile",{}]');
		set(53, 0, 'TxDefaultProfile', 1, 3600, 11000);
		set(54, 1, 'TxDefaultProfile', 1, 3600, 7000);
		simulator.rpc.handleText(
			'[2,"fb-specific","GetCompositeSchedule",{"connectorId":1,"duration":3600}]',
		);
		await flushMicrotasks(30);
		expect(simulator.state.compositeSchedules['1']).toMatchObject({
			chargingSchedulePeriod: [{ startPeriod: 0, limit: 7000 }],
		});
		simulator.dispose();
	});
	it('removes transaction profiles when the transaction ends', async () => {
		const { simulator } = await ready();
		await simulator.startChargingSession(1, 'TAG');
		simulator.rpc.handleText(
			JSON.stringify([
				2,
				'tx-prof',
				'SetChargingProfile',
				{
					connectorId: 1,
					csChargingProfiles: {
						chargingProfileId: 40,
						stackLevel: 5,
						chargingProfilePurpose: 'TxProfile',
						chargingProfileKind: 'Relative',
						chargingSchedule: {
							chargingRateUnit: 'W',
							duration: 3600,
							chargingSchedulePeriod: [{ startPeriod: 0, limit: 7000 }],
						},
					},
				},
			]),
		);
		await flushMicrotasks(30);
		expect(simulator.chargingProfiles.list()).toHaveLength(1);
		await simulator.stopTransaction(1);
		expect(simulator.chargingProfiles.list()).toHaveLength(0);
		simulator.rpc.handleText(
			'[2,"tx-comp","GetCompositeSchedule",{"connectorId":1,"duration":60}]',
		);
		await flushMicrotasks(30);
		expect(simulator.state.compositeSchedules['1']).toMatchObject({
			chargingSchedulePeriod: [{ startPeriod: 0, limit: 32000 }],
		});
		simulator.dispose();
	});

	it('anchors relative profiles on the simulator clock after boot', async () => {
		const { simulator } = await ready();
		await simulator.bootNotification();
		expect(simulator.getState().clockOffsetMs).not.toBe(0);
		simulator.rpc.handleText(
			JSON.stringify([
				2,
				'boot-prof',
				'SetChargingProfile',
				{
					connectorId: 1,
					csChargingProfiles: {
						chargingProfileId: 60,
						stackLevel: 1,
						chargingProfilePurpose: 'TxDefaultProfile',
						chargingProfileKind: 'Absolute',
						chargingSchedule: {
							chargingRateUnit: 'W',
							duration: 3600,
							chargingSchedulePeriod: [
								{ startPeriod: 0, limit: 11000 },
								{ startPeriod: 1800, limit: 7000 },
							],
						},
					},
				},
			]),
		);
		simulator.rpc.handleText(
			'[2,"boot-comp","GetCompositeSchedule",{"connectorId":1,"duration":3600}]',
		);
		await flushMicrotasks(30);
		expect(simulator.state.compositeSchedules['1']).toMatchObject({
			chargingSchedulePeriod: [
				{ startPeriod: 0, limit: 11000 },
				{ startPeriod: 1800, limit: 7000 },
			],
		});
		simulator.dispose();
	});

	it('rejects fractional durations', async () => {
		const { simulator, transport } = await ready();
		transport.sent.length = 0;
		simulator.rpc.handleText(
			JSON.stringify([
				2,
				'frac-set',
				'SetChargingProfile',
				{
					connectorId: 1,
					csChargingProfiles: {
						chargingProfileId: 70,
						stackLevel: 1,
						chargingProfilePurpose: 'TxDefaultProfile',
						chargingProfileKind: 'Absolute',
						chargingSchedule: {
							chargingRateUnit: 'W',
							duration: 1.5,
							chargingSchedulePeriod: [{ startPeriod: 0, limit: 1000 }],
						},
					},
				},
			]),
		);
		simulator.rpc.handleText(
			'[2,"frac-comp","GetCompositeSchedule",{"connectorId":1,"duration":1.5}]',
		);
		await flushMicrotasks(30);
		expect(
			transport.sent.some((text) => text.includes('[3,"frac-set",{"status":"Rejected"}]')),
		).toBe(true);
		expect(
			transport.sent.some((text) => text.includes('[3,"frac-comp",{"status":"Rejected"}]')),
		).toBe(true);
		simulator.dispose();
	});

	it('blocks new starts while a reset drains and queues StopTransaction on timeout', async () => {
		const { clock, factory, simulator, transport } = await ready();
		await simulator.startChargingSession(1, 'TAG');
		const respond = transport.send.bind(transport);
		transport.send = (text: string): void => {
			const frame = JSON.parse(text) as unknown[];
			if (frame[0] === 2 && frame[2] === 'StopTransaction') {
				transport.sent.push(text);
				return;
			}
			respond(text);
		};
		transport.sent.length = 0;
		simulator.rpc.handleText('[2,"reset-drain","Reset",{"type":"Hard"}]');
		await flushMicrotasks(30);
		simulator.rpc.handleText(
			'[2,"start-drain","RemoteStartTransaction",{"connectorId":1,"idTag":"TAG"}]',
		);
		await flushMicrotasks(30);
		expect(
			transport.sent.some((text) => text.includes('[3,"start-drain",{"status":"Rejected"}]')),
		).toBe(true);
		clock.advance(15_000);
		await flushMicrotasks(60);
		expect(factory.transports).toHaveLength(2);
		expect(
			simulator
				.getQueue()
				.some(
					(entry) => entry.action === 'StopTransaction' && entry.payload['reason'] === 'HardReset',
				),
		).toBe(true);
		simulator.dispose();
	});

	it('filters TriggerMessage by connector and supports connector 0', async () => {
		const { simulator, transport } = await ready({ connectors: 2 });
		transport.sent.length = 0;
		simulator.rpc.handleText(
			'[2,"trig-status","TriggerMessage",{"requestedMessage":"StatusNotification","connectorId":2}]',
		);
		await flushMicrotasks(30);
		const statusFrames = transport.sent
			.map((text) => JSON.parse(text) as unknown[])
			.filter((frame) => frame[0] === 2 && frame[2] === 'StatusNotification')
			.map((frame) => frame[3] as Record<string, unknown>);
		expect(statusFrames).toHaveLength(1);
		expect(statusFrames[0]?.['connectorId']).toBe(2);
		transport.sent.length = 0;
		simulator.rpc.handleText(
			'[2,"trig-meter","TriggerMessage",{"requestedMessage":"MeterValues","connectorId":0}]',
		);
		await flushMicrotasks(30);
		const meter = transport.sent
			.map((text) => JSON.parse(text) as unknown[])
			.find((frame) => frame[2] === 'MeterValues');
		expect((meter?.[3] as Record<string, unknown>)['connectorId']).toBe(0);
		simulator.dispose();
	});

	it('lets ClearChargingProfile id override other filters', async () => {
		const { simulator } = await ready({ connectors: 2 });
		const set = (id: number, connectorId: number): void => {
			simulator.rpc.handleText(
				JSON.stringify([
					2,
					`cp-${id}`,
					'SetChargingProfile',
					{
						connectorId,
						csChargingProfiles: {
							chargingProfileId: id,
							stackLevel: 1,
							chargingProfilePurpose: 'TxDefaultProfile',
							chargingProfileKind: 'Absolute',
							chargingSchedule: {
								chargingRateUnit: 'W',
								duration: 3600,
								chargingSchedulePeriod: [{ startPeriod: 0, limit: 1000 }],
							},
						},
					},
				]),
			);
		};
		set(80, 1);
		set(81, 2);
		await flushMicrotasks(30);
		simulator.rpc.handleText('[2,"clear-id","ClearChargingProfile",{"id":80,"connectorId":2}]');
		await flushMicrotasks(30);
		expect(simulator.chargingProfiles.list().map((profile) => profile.id)).toEqual([81]);
		simulator.dispose();
	});

	it('allows zero meter interval and stops the loop', async () => {
		const { clock, simulator, transport } = await ready();
		await simulator.startChargingSession(1, 'TAG');
		simulator.rpc.handleText(
			'[2,"meter-zero","ChangeConfiguration",{"key":"MeterValueSampleInterval","value":"0"}]',
		);
		await flushMicrotasks(30);
		expect(simulator.getMeterValueIntervalMs()).toBe(0);
		transport.sent.length = 0;
		clock.advance(60_000);
		await flushMicrotasks(30);
		expect(transport.sent.some((text) => text.includes('MeterValues'))).toBe(false);
		simulator.dispose();
	});

	it('shares one in-flight stop operation', async () => {
		const { simulator } = await ready();
		await simulator.startChargingSession(1, 'TAG');
		const first = simulator.stopTransaction(1);
		const second = simulator.stopTransaction(1);
		expect(second).toBe(first);
		await first;
		expect(simulator.getState().completedTransactions).toHaveLength(1);
		simulator.dispose();
	});

	it('does not queue a blocked StopTransaction', async () => {
		const { simulator, transport } = await ready();
		const clock = new FakeClock();
		const factory = new FakeTransportFactory();
		let sequence = 0;
		const blocked = new Simulator16({
			url: 'ws://localhost/CP16B',
			transport: factory.factory,
			clock,
			messageIds: () => `b-${++sequence}`,
			boot: { auto: false, required: false },
			station: {
				id: 'CP16B',
				vendor: 'Acme',
				model: 'AC-7',
				firmwareVersion: '1.0.0',
			},
			validation: {
				mode: 'block',
				validateOutbound: (frame) => (frame[2] === 'StopTransaction' ? ['blocked'] : null),
			},
		});
		blocked.connect();
		const blockedTransport = factory.transports[0]!;
		autoRespond(blockedTransport);
		blockedTransport.open();
		await flushMicrotasks(60);
		await blocked.startChargingSession(1, 'TAG');
		await expect(blocked.stopTransaction(1)).rejects.toMatchObject({
			code: 'validation-blocked',
		});
		expect(blocked.getQueue().some((entry) => entry.action === 'StopTransaction')).toBe(false);
		expect(blocked.getConnector(1)?.activeTransaction).not.toBeNull();
		expect(blocked.getConnector(1)?.status).toBe('Charging');
		blocked.rpc.handleText('[2,"reset-blocked","Reset",{"type":"Hard"}]');
		await flushMicrotasks(30);
		expect(blocked.state.pendingReboot).toBe(true);
		expect(factory.transports).toHaveLength(1);
		void transport;
		blocked.dispose();
		simulator.dispose();
	});

	it('keeps connector-scoped profiles alongside the station default', async () => {
		const { simulator } = await ready({ connectors: 2 });
		const set = (id: number, connectorId: number, limit: number): void => {
			simulator.rpc.handleText(
				JSON.stringify([
					2,
					`cross-${id}`,
					'SetChargingProfile',
					{
						connectorId,
						csChargingProfiles: {
							chargingProfileId: id,
							stackLevel: 1,
							chargingProfilePurpose: 'TxDefaultProfile',
							chargingProfileKind: 'Absolute',
							chargingSchedule: {
								chargingRateUnit: 'W',
								duration: 3600,
								chargingSchedulePeriod: [{ startPeriod: 0, limit }],
							},
						},
					},
				]),
			);
		};
		set(90, 0, 1000);
		set(91, 1, 2000);
		await flushMicrotasks(30);
		expect(simulator.chargingProfiles.list().map((profile) => profile.id)).toEqual([90, 91]);
		simulator.rpc.handleText(
			'[2,"cross-comp-1","GetCompositeSchedule",{"connectorId":1,"duration":60}]',
		);
		simulator.rpc.handleText(
			'[2,"cross-comp-2","GetCompositeSchedule",{"connectorId":2,"duration":60}]',
		);
		await flushMicrotasks(30);
		expect(simulator.state.compositeSchedules['1']).toMatchObject({
			chargingSchedulePeriod: [{ startPeriod: 0, limit: 2000 }],
		});
		expect(simulator.state.compositeSchedules['2']).toMatchObject({
			chargingSchedulePeriod: [{ startPeriod: 0, limit: 1000 }],
		});
		simulator.dispose();
	});

	it('stops meter loops when the interval is set to zero directly', async () => {
		const { clock, simulator, transport } = await ready();
		await simulator.startChargingSession(1, 'TAG');
		simulator.setMeterValueIntervalMs(0);
		transport.sent.length = 0;
		clock.advance(60_000);
		await flushMicrotasks(30);
		expect(transport.sent.some((text) => text.includes('MeterValues'))).toBe(false);
		simulator.dispose();
	});

	it('ignores a second reset while draining', async () => {
		const { clock, simulator, transport } = await ready();
		await simulator.startChargingSession(1, 'TAG');
		const respond = transport.send.bind(transport);
		transport.send = (text: string): void => {
			const frame = JSON.parse(text) as unknown[];
			if (frame[0] === 2 && frame[2] === 'StopTransaction') {
				transport.sent.push(text);
				return;
			}
			respond(text);
		};
		transport.sent.length = 0;
		simulator.rpc.handleText('[2,"reset-a","Reset",{"type":"Hard"}]');
		simulator.rpc.handleText('[2,"reset-b","Reset",{"type":"Hard"}]');
		await flushMicrotasks(30);
		clock.advance(15_000);
		await flushMicrotasks(60);
		expect(transport.sent.filter((text) => text.includes('"StopTransaction"')).length).toBe(1);
		expect(simulator.getState().completedTransactions).toHaveLength(1);
		expect(
			transport.sent.some((text) => text.includes('[3,"reset-b",{"status":"Rejected"}]')),
		).toBe(true);
		simulator.dispose();
	});

	it('stops transactions, replies, and reboots on a Hard reset', async () => {
		const { factory, simulator, transport } = await ready();
		await simulator.startChargingSession(1, 'TAG');
		transport.sent.length = 0;
		simulator.rpc.handleText('[2,"reset-hard","Reset",{"type":"Hard"}]');
		await flushMicrotasks(60);
		expect(transport.sent.some((text) => text.includes('"reason":"HardReset"'))).toBe(true);
		expect(simulator.getConnector(1)?.activeTransaction).toBeNull();
		expect(factory.transports).toHaveLength(2);
		const second = factory.transports[1]!;
		autoRespond(second);
		second.open();
		await flushMicrotasks(60);
		expect(second.sent.some((text) => text.includes('BootNotification'))).toBe(true);
		simulator.dispose();
	});

	it('validates and sends each TriggerMessage', async () => {
		const { clock, simulator, transport } = await ready();
		transport.sent.length = 0;
		for (const requested of [
			'BootNotification',
			'Heartbeat',
			'StatusNotification',
			'MeterValues',
			'DiagnosticsStatusNotification',
			'FirmwareStatusNotification',
		]) {
			simulator.rpc.handleText(
				JSON.stringify([2, `trig-${requested}`, 'TriggerMessage', { requestedMessage: requested }]),
			);
			await flushMicrotasks(30);
			expect(
				transport.sent.some((text) =>
					text.includes(`[3,"trig-${requested}",{"status":"Accepted"}]`),
				),
			).toBe(true);
		}
		simulator.rpc.handleText('[2,"trig-bad","TriggerMessage",{"requestedMessage":"Unknown"}]');
		simulator.rpc.handleText(
			'[2,"trig-diag","TriggerMessage",{"requestedMessage":"DiagnosticsStatusNotification"}]',
		);
		await flushMicrotasks(30);
		expect(
			transport.sent.some((text) => text.includes('[3,"trig-bad",{"status":"NotImplemented"}]')),
		).toBe(true);
		clock.advance(1);
		simulator.dispose();
	});

	it('rejects TriggerMessage before ready', async () => {
		const { simulator, transport } = await ready({ boot: false });
		transport.sent.length = 0;
		simulator.rpc.handleText('[2,"trig-1","TriggerMessage",{"requestedMessage":"Heartbeat"}]');
		await flushMicrotasks(30);
		expect(transport.sent.some((text) => text.includes('[3,"trig-1",{"status":"Rejected"}]'))).toBe(
			true,
		);
		simulator.dispose();
	});

	it('models the configuration catalog and applies mutable values', async () => {
		const { clock, simulator, transport } = await ready();
		transport.sent.length = 0;
		simulator.rpc.handleText('[2,"cfg-1","GetConfiguration",{"key":["Bogus"]}]');
		simulator.rpc.handleText(
			'[2,"cfg-2","ChangeConfiguration",{"key":"HeartbeatInterval","value":"30"}]',
		);
		simulator.rpc.handleText(
			'[2,"cfg-3","ChangeConfiguration",{"key":"ChargePointVendor","value":"X"}]',
		);
		simulator.rpc.handleText('[2,"cfg-4","ChangeConfiguration",{"key":"Bogus","value":"X"}]');
		simulator.rpc.handleText(
			'[2,"cfg-5","ChangeConfiguration",{"key":"LocalAuthListEnabled","value":"false"}]',
		);
		await flushMicrotasks(30);
		expect(simulator.getHeartbeatIntervalMs()).toBe(30_000);
		expect(transport.sent.some((text) => text.includes('[3,"cfg-2",{"status":"Accepted"}]'))).toBe(
			true,
		);
		expect(transport.sent.some((text) => text.includes('[3,"cfg-3",{"status":"Rejected"}]'))).toBe(
			true,
		);
		expect(
			transport.sent.some((text) => text.includes('[3,"cfg-4",{"status":"NotSupported"}]')),
		).toBe(true);
		expect(transport.sent.some((text) => text.includes('"unknownKey":["Bogus"]'))).toBe(true);
		expect(simulator.getState().configuration?.['LocalAuthListEnabled']).toBe('false');

		await simulator.startChargingSession(1, 'TAG');
		transport.sent.length = 0;
		simulator.rpc.handleText(
			'[2,"cfg-6","ChangeConfiguration",{"key":"MeterValueSampleInterval","value":"1"}]',
		);
		await flushMicrotasks(30);
		clock.advance(1000);
		await flushMicrotasks(30);
		expect(transport.sent.some((text) => text.includes('"MeterValues"'))).toBe(true);
		simulator.dispose();
	});

	it('cancels diagnostics and firmware flows on reconnect', async () => {
		const { clock, simulator, transport } = await ready();
		transport.sent.length = 0;
		simulator.rpc.handleText('[2,"diag-1","GetDiagnostics",{"location":"https://example.test"}]');
		simulator.rpc.handleText(
			'[2,"fw-1","UpdateFirmware",{"location":"https://example.test","retrieveDate":"2026-01-01T00:00:00Z"}]',
		);
		await flushMicrotasks(30);
		transport.close(1006, 'lost');
		clock.advance(10_000);
		await flushMicrotasks(30);
		expect(simulator.state.diagnosticsStatus).toBe('Uploading');
		expect(simulator.state.firmwareStatus).toBe('Downloading');
		simulator.dispose();
	});

	it('emits diagnostics and firmware status sequences', async () => {
		const { clock, simulator, transport } = await ready();
		transport.sent.length = 0;
		simulator.rpc.handleText('[2,"diag-1","GetDiagnostics",{"location":"https://example.test"}]');
		simulator.rpc.handleText(
			'[2,"fw-1","UpdateFirmware",{"location":"https://example.test","retrieveDate":"2026-01-01T00:00:00Z"}]',
		);
		await flushMicrotasks(30);
		clock.advance(1000);
		await flushMicrotasks(30);
		clock.advance(2000);
		await flushMicrotasks(30);
		const statuses = transport.sent
			.map((text) => JSON.parse(text) as unknown[])
			.filter((frame) => frame[0] === 2)
			.map((frame) => String(frame[2]));
		expect(statuses).toContain('DiagnosticsStatusNotification');
		expect(statuses).toContain('FirmwareStatusNotification');
		expect(simulator.state.diagnosticsStatus).toBe('Uploaded');
		expect(simulator.state.firmwareStatus).toBe('Installed');
		simulator.dispose();
	});

	it('expires reservations and applies scheduled availability', async () => {
		const { clock, simulator } = await ready();
		simulator.rpc.handleText(
			JSON.stringify([
				2,
				'res-1',
				'ReserveNow',
				{
					connectorId: 1,
					expiryDate: '1970-01-01T00:01:00Z',
					idTag: 'TAG',
					reservationId: 9,
				},
			]),
		);
		await flushMicrotasks(30);
		expect(simulator.getConnector(1)?.reservation).toMatchObject({ id: 9 });
		clock.advance(60_000);
		await flushMicrotasks(30);
		expect(simulator.getConnector(1)?.reservation).toBeNull();
		expect(simulator.getConnector(1)?.status).toBe('Available');

		await simulator.startChargingSession(1, 'TAG');
		simulator.rpc.handleText(
			'[2,"avail-1","ChangeAvailability",{"connectorId":1,"type":"Inoperative"}]',
		);
		await flushMicrotasks(30);
		expect(simulator.getConnector(1)?.pendingAvailability).toBe('Inoperative');
		await simulator.stopTransaction(1);
		expect(simulator.getConnector(1)?.status).toBe('Unavailable');
		simulator.dispose();
	});

	it('caps long reservation timers and re-arms them', async () => {
		const { clock, simulator } = await ready();
		const expiry = new Date(2_147_483_647 + 1000).toISOString();
		simulator.rpc.handleText(
			JSON.stringify([
				2,
				'res-long',
				'ReserveNow',
				{ connectorId: 1, expiryDate: expiry, idTag: 'TAG', reservationId: 12 },
			]),
		);
		await flushMicrotasks(30);
		expect(simulator.getConnector(1)?.reservation).toMatchObject({ id: 12 });
		clock.advance(2_147_483_647);
		await flushMicrotasks(30);
		expect(simulator.getConnector(1)?.reservation).not.toBeNull();
		clock.advance(1000);
		await flushMicrotasks(30);
		expect(simulator.getConnector(1)?.reservation).toBeNull();
		simulator.dispose();
	});

	it('replaces duplicate reservations and clears them on unavailable', async () => {
		const { simulator, transport } = await ready({ connectors: 2 });
		transport.sent.length = 0;
		const reserve = (connectorId: number, reservationId: number): string =>
			JSON.stringify([
				2,
				`res-${connectorId}-${reservationId}`,
				'ReserveNow',
				{
					connectorId,
					expiryDate: '2030-01-01T00:00:00Z',
					idTag: 'TAG',
					reservationId,
				},
			]);
		simulator.rpc.handleText(reserve(1, 20));
		await flushMicrotasks(30);
		simulator.rpc.handleText(reserve(1, 20));
		await flushMicrotasks(30);
		simulator.rpc.handleText(reserve(2, 20));
		await flushMicrotasks(30);
		expect(simulator.getConnector(1)?.reservation).toBeNull();
		expect(simulator.getConnector(1)?.status).toBe('Available');
		expect(simulator.getConnector(2)?.reservation).toMatchObject({ id: 20 });
		expect(simulator.getConnector(2)?.status).toBe('Reserved');

		simulator.rpc.handleText(
			'[2,"avail-res","ChangeAvailability",{"connectorId":2,"type":"Operative"}]',
		);
		await flushMicrotasks(30);
		expect(simulator.getConnector(2)?.status).toBe('Reserved');
		simulator.rpc.handleText(
			'[2,"avail-res-off","ChangeAvailability",{"connectorId":2,"type":"Inoperative"}]',
		);
		await flushMicrotasks(30);
		expect(simulator.getConnector(2)?.reservation).toBeNull();
		expect(simulator.getConnector(2)?.status).toBe('Unavailable');
		simulator.rpc.handleText('[2,"cancel-gone","CancelReservation",{"reservationId":20}]');
		simulator.rpc.handleText(reserve(1, 21));
		await flushMicrotasks(30);
		simulator.rpc.handleText(
			'[2,"res-unavailable","ReserveNow",{"connectorId":2,"expiryDate":"2030-01-01T00:00:00Z","idTag":"TAG","reservationId":22}]',
		);
		await flushMicrotasks(30);
		expect(
			transport.sent.some((text) => text.includes('[3,"cancel-gone",{"status":"Rejected"}]')),
		).toBe(true);
		expect(
			transport.sent.some((text) =>
				text.includes('[3,"res-unavailable",{"status":"Unavailable"}]'),
			),
		).toBe(true);
		simulator.dispose();
	});

	it('cancels and unlocks reservations', async () => {
		const { simulator } = await ready();
		simulator.rpc.handleText(
			JSON.stringify([
				2,
				'res-1',
				'ReserveNow',
				{
					connectorId: 1,
					expiryDate: '2030-01-01T00:00:00Z',
					idTag: 'TAG',
					reservationId: 4,
				},
			]),
		);
		await flushMicrotasks(30);
		simulator.rpc.handleText('[2,"cancel-1","CancelReservation",{"reservationId":4}]');
		await flushMicrotasks(30);
		expect(simulator.getConnector(1)?.reservation).toBeNull();
		expect(simulator.getConnector(1)?.status).toBe('Available');

		simulator.rpc.handleText(
			JSON.stringify([
				2,
				'res-2',
				'ReserveNow',
				{
					connectorId: 1,
					expiryDate: '2030-01-01T00:00:00Z',
					idTag: 'TAG',
					reservationId: 5,
				},
			]),
		);
		await flushMicrotasks(30);
		simulator.rpc.handleText('[2,"unlock-1","UnlockConnector",{"connectorId":1}]');
		await flushMicrotasks(30);
		expect(simulator.getConnector(1)?.reservation).toBeNull();
		expect(simulator.getConnector(1)?.status).toBe('Available');
		simulator.dispose();
	});

	it('applies station-wide availability to idle and active connectors', async () => {
		const { simulator } = await ready({ connectors: 2 });
		await simulator.startChargingSession(1, 'TAG');
		simulator.rpc.handleText(
			'[2,"avail-all","ChangeAvailability",{"connectorId":0,"type":"Inoperative"}]',
		);
		await flushMicrotasks(30);
		expect(simulator.getConnector(1)?.pendingAvailability).toBe('Inoperative');
		expect(simulator.getConnector(2)?.status).toBe('Unavailable');
		await simulator.stopTransaction(1);
		expect(simulator.getConnector(1)?.status).toBe('Unavailable');
		expect(simulator.getConnector(2)?.status).toBe('Unavailable');
		simulator.dispose();
	});

	it('stops transactions and reboots on a Soft reset', async () => {
		const { factory, simulator, transport } = await ready();
		transport.sent.length = 0;
		await simulator.startChargingSession(1, 'TAG');
		simulator.rpc.handleText('[2,"reset-soft","Reset",{"type":"Soft"}]');
		await flushMicrotasks(60);
		expect(transport.sent.some((text) => text.includes('"reason":"SoftReset"'))).toBe(true);
		expect(simulator.getConnector(1)?.activeTransaction).toBeNull();
		expect(factory.transports).toHaveLength(2);
		simulator.dispose();
	});
});
