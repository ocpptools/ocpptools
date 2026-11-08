// SPDX-License-Identifier: Apache-2.0
// SPDX-FileCopyrightText: 2026 Rodolfo Carrillo

import { describe, expect, it } from 'vitest';

import { Simulator16 } from '../src/1.6.js';
import { Simulator201 } from '../src/2.0.1.js';
import { FakeClock, flushMicrotasks } from './helpers/fake-clock.js';
import { FakeTransportFactory, type FakeTransport } from './helpers/fake-transport.js';
import { MemoryStorage } from './helpers/memory-storage.js';

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
			Authorize: { idTagInfo: { status: 'Accepted' }, idTokenInfo: { status: 'Accepted' } },
			StartTransaction: { transactionId: 7, idTagInfo: { status: 'Accepted' } },
			StopTransaction: { idTagInfo: { status: 'Accepted' } },
			Heartbeat: { currentTime: '2026-01-01T00:00:00Z' },
			DataTransfer: { status: 'Accepted' },
		};
		transport.receive(JSON.stringify([3, id, responses[action] ?? {}]));
	};
}

function create16(storage: MemoryStorage, options: { bootRequired?: boolean } = {}) {
	const clock = new FakeClock();
	const factory = new FakeTransportFactory();
	let sequence = 0;
	const simulator = new Simulator16({
		url: 'ws://localhost/CP16',
		transport: factory.factory,
		clock,
		messageIds: () => `id-${++sequence}`,
		boot:
			options.bootRequired === true
				? { auto: false, required: true }
				: { auto: false, required: false },
		station: {
			id: 'CP16',
			vendor: 'Acme',
			model: 'AC-7',
			firmwareVersion: '1.0.0',
			connectorCount: 1,
			defaultIdTag: 'TAG',
		},
		persistence: {
			storage,
			key: 'snapshot',
			includeHistory: true,
		},
	});
	return { clock, factory, simulator };
}

function create201(storage: MemoryStorage) {
	const clock = new FakeClock();
	const factory = new FakeTransportFactory();
	let sequence = 0;
	const simulator = new Simulator201({
		url: 'ws://localhost/CP201',
		transport: factory.factory,
		clock,
		messageIds: () => `id-${++sequence}`,
		boot: { auto: false, required: false },
		station: {
			id: 'CP201',
			vendorName: 'Acme',
			model: 'AC-22',
			firmwareVersion: '2.0.0',
		},
		persistence: {
			storage,
			key: 'snapshot',
			includeHistory: true,
		},
	});
	return { clock, factory, simulator };
}

async function open(
	simulator: Simulator16 | Simulator201,
	factory: FakeTransportFactory,
): Promise<FakeTransport> {
	simulator.connect();
	const transport = factory.transports[0]!;
	autoRespond(transport);
	transport.open();
	await flushMicrotasks(60);
	return transport;
}

describe('persistence', () => {
	it('round-trips a 1.6 transaction, queue, history, and configuration', async () => {
		const storage = new MemoryStorage();
		const first = create16(storage);
		await open(first.simulator, first.factory);
		const started = await first.simulator.startChargingSession(1, 'TAG');
		expect(started.ok).toBe(true);
		await first.simulator.sendMeterValues(1);
		first.simulator.setFaults({ latencyMs: 25, dropRate: 0.25, malformRate: 0.1 });
		first.simulator.setValidationMode('block');
		const snapshot = first.simulator.exportSnapshot();
		expect(snapshot.protocol).toBe('1.6');
		expect(snapshot.history?.length).toBeGreaterThan(0);
		expect(snapshot.state).toMatchObject({
			connectors: [{ id: 1, activeTransaction: { transactionId: 7 } }],
		});
		const serialized = JSON.stringify(snapshot);
		expect(serialized).not.toContain('undefined');
		expect(serialized).not.toContain('NaN');

		const second = create16(storage);
		const restored = second.simulator.restoreSnapshot(JSON.parse(serialized));
		expect(restored).toEqual({ restored: true });
		expect(second.simulator.getConnector(1)?.activeTransaction).toMatchObject({
			transactionId: 7,
			idTag: 'TAG',
		});
		expect(second.simulator.getFaults()).toEqual({
			latencyMs: 25,
			dropRate: 0.25,
			malformRate: 0.1,
		});
		expect(second.simulator.getValidationMode()).toBe('block');
		expect(second.simulator.getHistory()).toHaveLength(snapshot.history?.length ?? 0);
		expect(second.simulator.getPendingCalls()).toHaveLength(0);
		expect(second.simulator.getMetrics()).toMatchObject({ errorCountLastMinute: 0 });
		await open(second.simulator, second.factory);
		second.clock.advance(30_000);
		await flushMicrotasks(60);
		expect(second.simulator.getHistory().some((entry) => entry.action === 'MeterValues')).toBe(
			true,
		);
		first.simulator.dispose();
		second.simulator.dispose();
	});

	it('round-trips 2.0.1 device model and services state', async () => {
		const storage = new MemoryStorage();
		const first = create201(storage);
		await open(first.simulator, first.factory);
		first.simulator.state.variables['Custom/Variable'] = '42';
		first.simulator.state.services.customer = { data: 'secret' };
		const snapshot = first.simulator.exportSnapshot();

		const second = create201(storage);
		expect(second.simulator.restoreSnapshot(snapshot)).toEqual({ restored: true });
		expect(second.simulator.state.variables['Custom/Variable']).toBe('42');
		expect(second.simulator.state.services.customer).toEqual({ data: 'secret' });
		first.simulator.dispose();
		second.simulator.dispose();
	});

	it('exports a started 2.0.1 transaction without undefined fields', async () => {
		const storage = new MemoryStorage();
		const first = create201(storage);
		await open(first.simulator, first.factory);
		const started = await first.simulator.startChargingSession(1, 'TAG');
		expect(started.ok).toBe(true);
		expect(() => first.simulator.exportSnapshot()).not.toThrow();
		await expect(first.simulator.save()).resolves.toEqual({ saved: true });
		first.simulator.dispose();
	});

	it('normalizes in-flight flags and resets the clock offset on restore', async () => {
		const storage = new MemoryStorage();
		const first = create201(storage);
		await open(first.simulator, first.factory);
		await first.simulator.startChargingSession(1, 'TAG');
		first.simulator.state.evses[0]!.starting = true;
		first.simulator.state.evses[0]!.transaction!.stopping = true;
		const snapshot = first.simulator.exportSnapshot();

		const second = create201(storage);
		expect(second.simulator.restoreSnapshot(snapshot)).toEqual({ restored: true });
		expect(second.simulator.state.evses[0]?.starting).toBe(false);
		expect(second.simulator.state.evses[0]?.transaction?.stopping).toBe(false);
		first.simulator.dispose();
		second.simulator.dispose();

		const booted = create16(storage);
		await open(booted.simulator, booted.factory);
		await booted.simulator.bootNotification();
		expect(booted.simulator.getState().clockOffsetMs).not.toBe(0);
		const legacySnapshot = booted.simulator.exportSnapshot();
		expect(booted.simulator.restoreSnapshot(legacySnapshot)).toEqual({ restored: true });
		expect(booted.simulator.getState().clockOffsetMs).toBe(0);
		booted.simulator.dispose();
	});

	it('round-trips valid 1.6 local authorization entries', async () => {
		const storage = new MemoryStorage();
		const first = create16(storage);
		await open(first.simulator, first.factory);
		first.simulator.rpc.handleText(
			JSON.stringify([
				2,
				'list-1',
				'SendLocalList',
				{
					listVersion: 1,
					updateType: 'Full',
					localAuthorizationList: [
						{ idTag: 'A' },
						{ idTag: 'B', idTagInfo: { status: 'Accepted', parentIdTag: 'P' } },
					],
				},
			]),
		);
		await flushMicrotasks(30);
		const snapshot = first.simulator.exportSnapshot();
		const second = create16(storage);
		expect(second.simulator.restoreSnapshot(snapshot)).toEqual({ restored: true });
		expect(second.simulator.state.localAuthorizationList).toEqual([
			{ idTag: 'A' },
			{ idTag: 'B', idTagInfo: { status: 'Accepted', parentIdTag: 'P' } },
		]);
		first.simulator.dispose();
		second.simulator.dispose();
	});

	it('round-trips 1.6 configuration, status flows, availability, and profiles', () => {
		const storage = new MemoryStorage();
		const first = create16(storage);
		first.simulator.state.configuration = { HeartbeatInterval: '30' };
		first.simulator.state.diagnosticsStatus = 'Uploaded';
		first.simulator.state.firmwareStatus = 'Installed';
		first.simulator.getConnector(1)!.pendingAvailability = 'Inoperative';
		first.simulator.state.chargingProfiles = [
			{
				connectorId: 1,
				id: 3,
				stackLevel: 1,
				purpose: 'TxDefaultProfile',
				kind: 'Absolute',
				schedule: {
					chargingRateUnit: 'W',
					duration: 3600,
					chargingSchedulePeriod: [{ startPeriod: 0, limit: 7000 }],
				},
				periods: [{ startPeriod: 0, limit: 7000 }],
				validFrom: '2020-01-01T00:00:00Z',
			},
		];
		const snapshot = first.simulator.exportSnapshot();
		const second = create16(storage);
		expect(second.simulator.restoreSnapshot(snapshot)).toEqual({ restored: true });
		expect(second.simulator.state.configuration).toEqual({ HeartbeatInterval: '30' });
		expect(second.simulator.state.diagnosticsStatus).toBe('Uploaded');
		expect(second.simulator.state.firmwareStatus).toBe('Installed');
		expect(second.simulator.getConnector(1)?.pendingAvailability).toBe('Inoperative');
		expect(second.simulator.state.chargingProfiles[0]).toMatchObject({
			id: 3,
			purpose: 'TxDefaultProfile',
			validFrom: '2020-01-01T00:00:00Z',
		});
		first.simulator.dispose();
		second.simulator.dispose();
	});

	it('does not persist a pending reboot drain flag', async () => {
		const storage = new MemoryStorage();
		const first = create16(storage);
		first.simulator.state.pendingReboot = true;
		const snapshot = first.simulator.exportSnapshot();
		const second = create16(storage);
		expect(second.simulator.restoreSnapshot(snapshot)).toEqual({ restored: true });
		expect(second.simulator.state.pendingReboot).toBeUndefined();
		await open(second.simulator, second.factory);
		await expect(second.simulator.startChargingSession(1, 'TAG')).resolves.toMatchObject({
			ok: true,
		});
		first.simulator.dispose();
		second.simulator.dispose();
	});

	it('does not persist undefined optional state after stop, availability, or reset', async () => {
		const storage = new MemoryStorage();
		const first = create16(storage);
		await open(first.simulator, first.factory);
		await first.simulator.startChargingSession(1, 'TAG');
		first.simulator.rpc.handleText(
			'[2,"avail-opt","ChangeAvailability",{"connectorId":1,"type":"Inoperative"}]',
		);
		await flushMicrotasks(30);
		expect(first.simulator.getConnector(1)?.pendingAvailability).toBe('Inoperative');
		expect(() => first.simulator.exportSnapshot()).not.toThrow();
		await first.simulator.stopTransaction(1);
		expect(() => first.simulator.exportSnapshot()).not.toThrow();
		first.simulator.rpc.handleText('[2,"reset-opt","Reset",{"type":"Hard"}]');
		await flushMicrotasks(60);
		expect(() => first.simulator.exportSnapshot()).not.toThrow();
		first.simulator.dispose();
	});

	it('cancels restored status flows', async () => {
		const storage = new MemoryStorage();
		const first = create16(storage);
		await open(first.simulator, first.factory);
		first.simulator.rpc.handleText(
			'[2,"diag-restore","GetDiagnostics",{"location":"https://example.test"}]',
		);
		await flushMicrotasks(30);
		const snapshot = first.simulator.exportSnapshot();
		expect(first.simulator.state.diagnosticsStatus).toBe('Uploading');
		expect(first.simulator.restoreSnapshot(snapshot)).toEqual({ restored: true });
		first.clock.advance(1000);
		await flushMicrotasks(30);
		expect(first.simulator.state.diagnosticsStatus).toBe('Uploading');
		first.simulator.dispose();
	});

	it('restores a queued snapshot with the same message IDs', async () => {
		const storage = new MemoryStorage();
		const first = create16(storage, { bootRequired: true });
		first.simulator.connect();
		first.factory.transports[0]?.open();
		await flushMicrotasks(30);
		await first.simulator.sendOrQueue('Authorize', { idTag: 'A' });
		const queued = first.simulator.getQueue();
		expect(queued).toHaveLength(1);
		const snapshot = first.simulator.exportSnapshot();

		const second = create16(storage, { bootRequired: true });
		expect(second.simulator.restoreSnapshot(snapshot)).toEqual({ restored: true });
		expect(
			second.simulator.getQueue().map((entry) => ({
				action: entry.action,
				messageId: entry.messageId,
				payload: entry.payload,
			})),
		).toEqual(
			queued.map((entry) => ({
				action: entry.action,
				messageId: entry.messageId,
				payload: entry.payload,
			})),
		);
		first.simulator.dispose();
		second.simulator.dispose();
	});

	it('tracks restored queue IDs against new allocations', async () => {
		const storage = new MemoryStorage();
		const first = create16(storage, { bootRequired: true });
		first.simulator.connect();
		first.factory.transports[0]?.open();
		await flushMicrotasks(30);
		await first.simulator.sendOrQueue('Authorize', { idTag: 'A' });
		const snapshot = first.simulator.exportSnapshot();

		const second = create16(storage, { bootRequired: true });
		expect(second.simulator.restoreSnapshot(snapshot)).toEqual({ restored: true });
		await second.simulator.sendOrQueue('DataTransfer', { vendorId: 'x' });
		const ids = second.simulator.getQueue().map((entry) => entry.messageId);
		expect(new Set(ids).size).toBe(ids.length);
		expect(second.simulator.getQueue()).toHaveLength(2);
		first.simulator.dispose();
		second.simulator.dispose();
	});

	it('rejects invalid snapshots without throwing or mutating state', () => {
		const storage = new MemoryStorage();
		const { simulator } = create16(storage);
		const before = simulator.getState();
		const validConfig = {
			faults: { latencyMs: 0, dropRate: 0, malformRate: 0 },
			validationMode: 'warn',
			inboundResponseMode: 'auto',
			heartbeatIntervalMs: 60_000,
			meterValueIntervalMs: 30_000,
		};
		const cases: unknown[] = [
			null,
			{},
			{ snapshotVersion: 2, protocol: '1.6', savedAt: 0, config: {}, state: {}, queue: {} },
			{ snapshotVersion: 1, protocol: '2.0.1', savedAt: 0, config: {}, state: {}, queue: {} },
			{
				snapshotVersion: 1,
				protocol: '1.6',
				savedAt: 0,
				config: validConfig,
				state: { connectors: 'nope' },
				queue: { version: 1, entries: [] },
			},
			{
				snapshotVersion: 1,
				protocol: '1.6',
				savedAt: 0,
				config: {
					...validConfig,
					faults: { latencyMs: Number.NaN, dropRate: 0, malformRate: 0 },
				},
				state: {},
				queue: { version: 1, entries: [] },
			},
			{
				snapshotVersion: 1,
				protocol: '1.6',
				savedAt: 0,
				config: { ...validConfig, validationMode: 'nope' },
				state: {},
				queue: { version: 1, entries: [] },
			},
			{
				snapshotVersion: 1,
				protocol: '1.6',
				savedAt: 0,
				config: { ...validConfig, inboundResponseMode: 'nope' },
				state: {},
				queue: { version: 1, entries: [] },
			},
			{
				snapshotVersion: 1,
				protocol: '1.6',
				savedAt: 0,
				config: { ...validConfig, heartbeatIntervalMs: 0 },
				state: {},
				queue: { version: 1, entries: [] },
			},
			{
				snapshotVersion: 1,
				protocol: '1.6',
				savedAt: 0,
				config: { ...validConfig, meterValueIntervalMs: 0 },
				state: {},
				queue: { version: 1, entries: [] },
			},
			{
				snapshotVersion: 1,
				protocol: '1.6',
				savedAt: 0,
				config: validConfig,
				state: {},
				queue: { version: 2, entries: [] },
			},
			{
				snapshotVersion: 1,
				protocol: '1.6',
				savedAt: 0,
				config: validConfig,
				state: {},
				queue: { version: 1, entries: [] },
				history: [{ at: 'nope' }],
			},
			{
				snapshotVersion: 1,
				protocol: '1.6',
				savedAt: 0,
				config: validConfig,
				state: {
					connectors: [
						{
							id: 1,
							status: 'Available',
							errorCode: 'NoError',
							meterWh: 0,
							chargingPowerKw: 0,
							activeTransaction: null,
							reservation: null,
							updatedAt: 0,
						},
					],
					completedTransactions: [],
					localAuthorizationList: [],
					localListVersion: 0,
					lastTransactionSeq: 0,
					chargingProfiles: [],
					compositeSchedules: {},
					defaultIdTag: 'TAG',
				},
				queue: { version: 1, entries: ['not-json'] },
			},
		];
		for (const snapshot of cases) {
			const result = simulator.restoreSnapshot(snapshot);
			expect(result.restored).toBe(false);
			expect(result.error?.code).toBe('invalid-snapshot');
		}
		expect(simulator.getState()).toEqual(before);
		simulator.dispose();
	});

	it('rearms 2.0.1 reservations after restore', async () => {
		const storage = new MemoryStorage();
		const first = create201(storage);
		first.simulator.state.reservations.push({
			id: 3,
			evseId: 1,
			expiryDateTime: '1970-01-01T00:01:00Z',
			idToken: { idToken: 'TAG', type: 'ISO14443' },
		});
		const snapshot = first.simulator.exportSnapshot();

		const second = create201(storage);
		expect(second.simulator.restoreSnapshot(snapshot)).toEqual({ restored: true });
		expect(second.simulator.state.reservations).toHaveLength(1);
		second.clock.advance(60_000);
		await flushMicrotasks(30);
		expect(second.simulator.state.reservations).toHaveLength(0);
		expect(
			second.simulator.getQueue().some((entry) => entry.action === 'ReservationStatusUpdate'),
		).toBe(true);
		first.simulator.dispose();
		second.simulator.dispose();
	});

	it('rejects hostile 2.0.1 states without mutating the engine', () => {
		const base = create201(new MemoryStorage()).simulator.exportSnapshot();
		const { simulator } = create201(new MemoryStorage());
		const before = simulator.getState();
		const mutations: Array<(snapshot: Record<string, unknown>) => void> = [
			(snapshot) => {
				(snapshot['state'] as Record<string, unknown>)['evses'] = [];
			},
			(snapshot) => {
				const state = snapshot['state'] as Record<string, unknown>;
				const evses = state['evses'] as Array<Record<string, unknown>>;
				evses[0]!['status'] = 'Broken';
			},
			(snapshot) => {
				const state = snapshot['state'] as Record<string, unknown>;
				const evses = state['evses'] as Array<Record<string, unknown>>;
				evses[0]!['transaction'] = { transactionId: 'x' };
			},
			(snapshot) => {
				(snapshot['state'] as Record<string, unknown>)['variables'] = { key: 1 };
			},
			(snapshot) => {
				(snapshot['state'] as Record<string, unknown>)['pendingResets'] = { station: 'yes' };
			},
			(snapshot) => {
				const state = snapshot['state'] as Record<string, unknown>;
				(state['monitoring'] as Record<string, unknown>)['base'] = 'Nope';
			},
			(snapshot) => {
				const state = snapshot['state'] as Record<string, unknown>;
				(state['monitoring'] as Record<string, unknown>)['level'] = 10;
			},
			(snapshot) => {
				const state = snapshot['state'] as Record<string, unknown>;
				const monitoring = state['monitoring'] as Record<string, unknown>;
				monitoring['monitors'] = [{ type: 'Nope' }];
			},
			(snapshot) => {
				const state = snapshot['state'] as Record<string, unknown>;
				(state['localAuthorization'] as Record<string, unknown>)['entries'] = 'nope';
			},
			(snapshot) => {
				const state = snapshot['state'] as Record<string, unknown>;
				state['reservations'] = [{ id: 1 }];
			},
			(snapshot) => {
				(snapshot['state'] as Record<string, unknown>)['charging'] = { profiles: 'nope' };
			},
			(snapshot) => {
				const state = snapshot['state'] as Record<string, unknown>;
				(state['services'] as Record<string, unknown>)['displays'] = [{ message: null }];
			},
			(snapshot) => {
				const state = snapshot['state'] as Record<string, unknown>;
				(state['security'] as Record<string, unknown>)['nextSerial'] = 0;
			},
			(snapshot) => {
				const state = snapshot['state'] as Record<string, unknown>;
				(state['security'] as Record<string, unknown>)['signedChains'] = { key: 1 };
			},
			(snapshot) => {
				(snapshot['state'] as Record<string, unknown>)['networkProfiles'] = [
					{ configurationSlot: 1, connectionData: 'nope', updatedAt: 0 },
				];
			},
		];
		for (const mutate of mutations) {
			const snapshot = JSON.parse(JSON.stringify(base)) as Record<string, unknown>;
			mutate(snapshot);
			const result = simulator.restoreSnapshot(snapshot);
			expect(result.restored).toBe(false);
			expect(result.error?.code).toBe('invalid-snapshot');
		}
		expect(simulator.getState()).toEqual(before);
		simulator.dispose();
	});

	it('handles missing keys and storage failures without throwing', async () => {
		const storage = new MemoryStorage();
		const { simulator } = create16(storage);
		await expect(simulator.load()).resolves.toEqual({ loaded: false });
		storage.failGet = true;
		const failedLoad = await simulator.load();
		expect(failedLoad.loaded).toBe(false);
		expect(failedLoad.error).toBeDefined();
		storage.failSet = true;
		const failedSave = await simulator.save();
		expect(failedSave.saved).toBe(false);
		expect(failedSave.error).toBeDefined();
		simulator.dispose();
	});

	it('loads a saved snapshot and applies it', async () => {
		const storage = new MemoryStorage();
		const first = create16(storage);
		await open(first.simulator, first.factory);
		await first.simulator.startChargingSession(1, 'TAG');
		await expect(first.simulator.save()).resolves.toEqual({ saved: true });

		const second = create16(storage);
		const loaded = await second.simulator.load();
		expect(loaded.loaded).toBe(true);
		expect(loaded.snapshot?.protocol).toBe('1.6');
		expect(second.simulator.getConnector(1)?.activeTransaction).not.toBeNull();
		first.simulator.dispose();
		second.simulator.dispose();
	});

	it('debounces autosave and cancels it on dispose', async () => {
		const storage = new MemoryStorage();
		const first = create16(storage);
		await open(first.simulator, first.factory);
		const auto = new Simulator16({
			url: 'ws://localhost/CP16',
			transport: new FakeTransportFactory().factory,
			clock: first.clock,
			station: {
				id: 'CP16',
				vendor: 'Acme',
				model: 'AC-7',
				firmwareVersion: '1.0.0',
			},
			persistence: {
				storage,
				key: 'auto',
				autoSave: true,
				saveDebounceMs: 100,
			},
		});
		auto.connect();
		await flushMicrotasks(20);
		await auto.sendStatusNotification(1, 'Preparing');
		first.clock.advance(50);
		expect(storage.values.has('auto')).toBe(false);
		first.clock.advance(50);
		await flushMicrotasks(30);
		expect(storage.values.has('auto')).toBe(true);
		await auto.sendStatusNotification(1, 'Available');
		auto.dispose();
		first.clock.advance(1000);
		await flushMicrotasks(30);
		expect(storage.values.has('auto')).toBe(true);
		first.simulator.dispose();
	});
});
