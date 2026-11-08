// SPDX-License-Identifier: Apache-2.0
// SPDX-FileCopyrightText: 2026 Rodolfo Carrillo

import { describe, expect, it } from 'vitest';

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

function monitorData(overrides: Record<string, unknown> = {}): Record<string, unknown> {
	return {
		value: 40,
		type: 'UpperThreshold',
		severity: 2,
		component: { name: 'OCPPCommCtrlr' },
		variable: { name: 'HeartbeatInterval' },
		...overrides,
	};
}

describe('Simulator201 device model', () => {
	it('runs periodic monitors and cancels them on clear', async () => {
		const harness = createHarness201();
		await harness.ready();
		await call(harness, 'mon-periodic', 'SetVariableMonitoring', {
			setMonitoringData: [monitorData({ value: 2, type: 'Periodic', severity: 2 })],
		});
		harness.clock.advance(2000);
		await harness.ready();
		const events = harness.calls('NotifyEvent');
		expect(events.length).toBeGreaterThan(0);
		const event = (events[0]![3] as Record<string, unknown>)['eventData'] as Array<
			Record<string, unknown>
		>;
		expect(event[0]).toMatchObject({ trigger: 'Periodic', variableMonitoringId: 1 });
		await call(harness, 'mon-periodic-clear', 'ClearVariableMonitoring', { id: [1] });
		const before = harness.calls('NotifyEvent').length;
		harness.clock.advance(1000);
		await harness.ready();
		expect(harness.calls('NotifyEvent')).toHaveLength(before);
	});

	it('aligns clock-aligned monitors and cancels them on base changes', async () => {
		const harness = createHarness201();
		await harness.ready();
		harness.clock.advance(2500);
		await call(harness, 'mon-aligned', 'SetVariableMonitoring', {
			setMonitoringData: [monitorData({ value: 2, type: 'PeriodicClockAligned', severity: 2 })],
		});
		harness.clock.advance(1400);
		await harness.ready();
		expect(harness.calls('NotifyEvent')).toHaveLength(0);
		harness.clock.advance(100);
		await harness.ready();
		expect(harness.calls('NotifyEvent')).toHaveLength(1);
		await harness.simulator.monitoring.setBase('FactoryDefault');
		harness.clock.advance(4000);
		await harness.ready();
		expect(harness.calls('NotifyEvent')).toHaveLength(1);
	});

	it('emits monitor events when an update changes the threshold state', async () => {
		const harness = createHarness201();
		await harness.ready();
		await call(harness, 'mon-up-1', 'SetVariableMonitoring', {
			setMonitoringData: [monitorData({ value: 40 })],
		});
		await call(harness, 'mon-up-0', 'SetVariables', {
			setVariableData: [
				{
					component: { name: 'OCPPCommCtrlr' },
					variable: { name: 'HeartbeatInterval' },
					attributeValue: '30',
				},
			],
		});
		await call(harness, 'mon-up-set', 'SetVariables', {
			setVariableData: [
				{
					component: { name: 'OCPPCommCtrlr' },
					variable: { name: 'HeartbeatInterval' },
					attributeValue: '50',
				},
			],
		});
		expect(harness.calls('NotifyEvent')).toHaveLength(1);
		await call(harness, 'mon-up-2', 'SetVariableMonitoring', {
			setMonitoringData: [monitorData({ id: 1, value: 60 })],
		});
		expect(harness.calls('NotifyEvent')).toHaveLength(2);
		const cleared = harness.calls('NotifyEvent')[1]![3] as Record<string, unknown>;
		expect((cleared['eventData'] as Array<Record<string, unknown>>)[0]).toMatchObject({
			cleared: true,
			variableMonitoringId: 1,
		});
		await call(harness, 'mon-up-3', 'SetVariableMonitoring', {
			setMonitoringData: [monitorData({ id: 1, value: 30 })],
		});
		expect(harness.calls('NotifyEvent')).toHaveLength(3);
		const alert = harness.calls('NotifyEvent')[2]![3] as Record<string, unknown>;
		expect((alert['eventData'] as Array<Record<string, unknown>>)[0]).toMatchObject({
			trigger: 'Alerting',
			actualValue: '50',
		});
		await call(harness, 'mon-up-4', 'SetVariableMonitoring', {
			setMonitoringData: [
				monitorData({
					type: 'LowerThreshold',
					severity: 2,
					value: 10,
				}),
			],
		});
		const duplicate = await call(harness, 'mon-up-5', 'SetVariableMonitoring', {
			setMonitoringData: [monitorData({ id: 1, type: 'LowerThreshold', severity: 2, value: 5 })],
		});
		expect(duplicate).toMatchObject({ setMonitoringResult: [{ status: 'Duplicate' }] });
	});

	it('does not emit threshold events for Delta or gated updates', async () => {
		const harness = createHarness201();
		await harness.ready();
		await call(harness, 'delta-up-setup', 'SetVariableMonitoring', {
			setMonitoringData: [
				monitorData({
					type: 'Delta',
					value: 10,
					severity: 1,
					component: { name: 'SampledDataCtrlr' },
					variable: { name: 'TxUpdatedInterval' },
				}),
			],
		});
		await call(harness, 'delta-up-1', 'SetVariables', {
			setVariableData: [
				{
					component: { name: 'SampledDataCtrlr' },
					variable: { name: 'TxUpdatedInterval' },
					attributeValue: '60',
				},
			],
		});
		expect(harness.calls('NotifyEvent')).toHaveLength(1);
		await call(harness, 'delta-up-2', 'SetVariableMonitoring', {
			setMonitoringData: [
				monitorData({
					id: 1,
					type: 'Delta',
					value: 100,
					severity: 1,
					component: { name: 'SampledDataCtrlr' },
					variable: { name: 'TxUpdatedInterval' },
				}),
			],
		});
		expect(harness.calls('NotifyEvent')).toHaveLength(1);
		await call(harness, 'delta-up-3', 'SetVariables', {
			setVariableData: [
				{
					component: { name: 'SampledDataCtrlr' },
					variable: { name: 'TxUpdatedInterval' },
					attributeValue: '130',
				},
			],
		});
		expect(harness.calls('NotifyEvent')).toHaveLength(1);

		await call(harness, 'gate-setup', 'SetVariableMonitoring', {
			setMonitoringData: [monitorData({ value: 40, severity: 5 })],
		});
		await call(harness, 'gate-level', 'SetMonitoringLevel', { severity: 2 });
		await call(harness, 'gate-update', 'SetVariableMonitoring', {
			setMonitoringData: [monitorData({ id: 2, value: 30, severity: 5 })],
		});
		expect(harness.calls('NotifyEvent')).toHaveLength(1);
		await call(harness, 'gate-transaction', 'SetVariableMonitoring', {
			setMonitoringData: [monitorData({ id: 2, value: 30, severity: 0, transaction: true })],
		});
		expect(harness.calls('NotifyEvent')).toHaveLength(1);
		await harness.simulator.startChargingSession(1, 'A');
		await call(harness, 'gate-transaction-update', 'SetVariableMonitoring', {
			setMonitoringData: [monitorData({ id: 2, value: 25, severity: 0, transaction: true })],
		});
		expect(harness.calls('NotifyEvent')).toHaveLength(2);
	});

	it('creates, updates, and rejects monitoring entries', async () => {
		const harness = createHarness201();
		await harness.ready();
		const created = await call(harness, 'mon-1', 'SetVariableMonitoring', {
			setMonitoringData: [monitorData()],
		});
		expect(created).toMatchObject({
			setMonitoringResult: [
				expect.objectContaining({
					status: 'Accepted',
					id: 1,
					type: 'UpperThreshold',
					severity: 2,
					component: { name: 'OCPPCommCtrlr' },
					variable: { name: 'HeartbeatInterval' },
				}),
			],
		});
		expect(harness.simulator.state.monitoring.monitors).toHaveLength(1);
		const duplicate = await call(harness, 'mon-2', 'SetVariableMonitoring', {
			setMonitoringData: [monitorData({ value: 50 })],
		});
		expect(duplicate).toMatchObject({
			setMonitoringResult: [{ status: 'Duplicate' }],
		});
		const updated = await call(harness, 'mon-3', 'SetVariableMonitoring', {
			setMonitoringData: [monitorData({ id: 1, value: 55, severity: 4 })],
		});
		expect(updated).toMatchObject({
			setMonitoringResult: [{ status: 'Accepted', id: 1, severity: 4 }],
		});
		expect(harness.simulator.state.monitoring.monitors[0]?.value).toBe(55);
		expect(
			await call(harness, 'mon-4', 'SetVariableMonitoring', {
				setMonitoringData: [monitorData({ id: 99 })],
			}),
		).toMatchObject({ setMonitoringResult: [{ status: 'Rejected' }] });
		expect(
			await call(harness, 'mon-5', 'SetVariableMonitoring', {
				setMonitoringData: [
					monitorData({
						id: 1,
						component: { name: 'SampledDataCtrlr' },
						variable: { name: 'TxUpdatedInterval' },
					}),
				],
			}),
		).toMatchObject({ setMonitoringResult: [{ status: 'Rejected' }] });
	});

	it('returns every monitoring validation status', async () => {
		const harness = createHarness201();
		await harness.ready();
		const results = await call(harness, 'mon-a', 'SetVariableMonitoring', {
			setMonitoringData: [
				monitorData({ component: { name: 'Nope' } }),
				monitorData({ variable: { name: 'Nope' } }),
				monitorData({ type: 'Periodic' }),
				monitorData({ type: 'Delta', value: 0 }),
				monitorData({
					component: { name: 'DeviceDataCtrlr' },
					variable: { name: 'Enabled' },
				}),
			],
		});
		expect(results).toMatchObject({
			setMonitoringResult: [
				{ status: 'UnknownComponent' },
				{ status: 'UnknownVariable' },
				{ status: 'Accepted' },
				{ status: 'Rejected' },
				{ status: 'UnsupportedMonitorType' },
			],
		});
		expect((await errorCall(harness, 'mon-b', 'SetVariableMonitoring', {})).slice(0, 3)).toEqual([
			4,
			'mon-b',
			'FormatViolation',
		]);
		expect(
			(
				await errorCall(harness, 'mon-c', 'SetVariableMonitoring', {
					setMonitoringData: [],
				})
			).slice(0, 3),
		).toEqual([4, 'mon-c', 'FormatViolation']);
		expect(
			(
				await errorCall(harness, 'mon-d', 'SetVariableMonitoring', {
					setMonitoringData: [monitorData({ severity: 'high' })],
				})
			).slice(0, 3),
		).toEqual([4, 'mon-d', 'FormatViolation']);
		expect(
			(
				await errorCall(harness, 'mon-e', 'SetVariableMonitoring', {
					setMonitoringData: [monitorData({ type: 'Bogus' })],
				})
			).slice(0, 3),
		).toEqual([4, 'mon-e', 'FormatViolation']);
	});

	it('clears monitors with one result per requested id', async () => {
		const harness = createHarness201();
		await harness.ready();
		await call(harness, 'clear-setup', 'SetVariableMonitoring', {
			setMonitoringData: [
				monitorData(),
				monitorData({ type: 'LowerThreshold', severity: 1, value: 10 }),
			],
		});
		const cleared = await call(harness, 'clear-1', 'ClearVariableMonitoring', {
			id: [1, 99, 1],
		});
		expect(cleared).toEqual({
			clearMonitoringResult: [
				{ status: 'Accepted', id: 1 },
				{ status: 'NotFound', id: 99 },
				{ status: 'NotFound', id: 1 },
			],
		});
		expect(harness.simulator.state.monitoring.monitors).toHaveLength(1);
		expect(
			(await errorCall(harness, 'clear-2', 'ClearVariableMonitoring', {})).slice(0, 3),
		).toEqual([4, 'clear-2', 'FormatViolation']);
		expect(
			(await errorCall(harness, 'clear-3', 'ClearVariableMonitoring', { id: [1.5] })).slice(0, 3),
		).toEqual([4, 'clear-3', 'FormatViolation']);
	});

	it('applies monitoring base and level commands', async () => {
		const harness = createHarness201();
		await harness.ready();
		await call(harness, 'base-setup', 'SetVariableMonitoring', {
			setMonitoringData: [monitorData()],
		});
		expect(await call(harness, 'base-1', 'SetMonitoringBase', { monitoringBase: 'All' })).toEqual({
			status: 'Accepted',
		});
		expect(harness.simulator.state.monitoring.monitors).toHaveLength(1);
		expect(
			await call(harness, 'base-2', 'SetMonitoringBase', {
				monitoringBase: 'FactoryDefault',
			}),
		).toEqual({ status: 'Accepted' });
		expect(harness.simulator.state.monitoring.monitors).toHaveLength(0);
		expect(
			await call(harness, 'base-3', 'SetMonitoringBase', {
				monitoringBase: 'HardWiredOnly',
			}),
		).toEqual({ status: 'Accepted' });
		expect(await call(harness, 'base-4', 'SetMonitoringBase', { monitoringBase: 'Bogus' })).toEqual(
			{ status: 'NotSupported' },
		);
		expect(await call(harness, 'level-1', 'SetMonitoringLevel', { severity: 0 })).toEqual({
			status: 'Accepted',
		});
		expect(harness.simulator.state.monitoring.level).toBe(0);
		expect(await call(harness, 'level-2', 'SetMonitoringLevel', { severity: 20 })).toEqual({
			status: 'Rejected',
		});
		expect(
			(await errorCall(harness, 'level-3', 'SetMonitoringLevel', { severity: 1.5 })).slice(0, 3),
		).toEqual([4, 'level-3', 'FormatViolation']);
	});

	it('builds monitoring reports with criteria and component filters', async () => {
		const harness = createHarness201();
		await harness.ready();
		expect(await call(harness, 'gmon-1', 'GetMonitoringReport', { requestId: 1 })).toEqual({
			status: 'EmptyResultSet',
		});
		await call(harness, 'gmon-setup', 'SetVariableMonitoring', {
			setMonitoringData: [
				monitorData(),
				monitorData({
					type: 'Delta',
					value: 5,
					severity: 1,
					component: { name: 'SampledDataCtrlr' },
					variable: { name: 'TxUpdatedInterval' },
				}),
			],
		});
		expect(
			await call(harness, 'gmon-2', 'GetMonitoringReport', {
				requestId: 2,
				monitoringCriteria: ['ThresholdMonitoring'],
			}),
		).toEqual({ status: 'Accepted' });
		const first = harness
			.calls('NotifyMonitoringReport')
			.map((frame) => frame[3] as Record<string, unknown>)
			.at(-1);
		expect(first?.['requestId']).toBe(2);
		expect((first?.['monitor'] as unknown[]).length).toBe(1);
		expect(
			(
				(first?.['monitor'] as Array<Record<string, unknown>>)[0]?.['variableMonitoring'] as Array<
					Record<string, unknown>
				>
			)[0],
		).toMatchObject({ id: 1, transaction: false, type: 'UpperThreshold', severity: 2 });
		expect(
			await call(harness, 'gmon-3', 'GetMonitoringReport', {
				requestId: 3,
				componentVariable: [{ component: { name: 'SampledDataCtrlr' } }],
			}),
		).toEqual({ status: 'Accepted' });
		expect(
			await call(harness, 'gmon-4', 'GetMonitoringReport', {
				requestId: 4,
				monitoringCriteria: ['PeriodicMonitoring'],
			}),
		).toEqual({ status: 'EmptyResultSet' });
		expect(
			await call(harness, 'gmon-5', 'GetMonitoringReport', {
				requestId: 5,
				monitoringCriteria: ['ThresholdMonitoring'],
				componentVariable: [{ component: { name: 'SampledDataCtrlr' } }],
			}),
		).toEqual({ status: 'EmptyResultSet' });
		expect(await call(harness, 'gmon-6', 'GetMonitoringReport', {})).toEqual({
			status: 'Rejected',
		});
		expect(
			(
				await errorCall(harness, 'gmon-7', 'GetMonitoringReport', {
					requestId: 1,
					monitoringCriteria: [],
				})
			).slice(0, 3),
		).toEqual([4, 'gmon-7', 'FormatViolation']);
		expect(
			(
				await errorCall(harness, 'gmon-8', 'GetMonitoringReport', {
					requestId: 1,
					monitoringCriteria: ['Bogus'],
				})
			).slice(0, 3),
		).toEqual([4, 'gmon-8', 'FormatViolation']);
		expect(
			(
				await errorCall(harness, 'gmon-9', 'GetMonitoringReport', {
					requestId: 1,
					componentVariable: [],
				})
			).slice(0, 3),
		).toEqual([4, 'gmon-9', 'FormatViolation']);
	});

	it('queues monitoring reports before boot', async () => {
		const harness = createHarness201({
			bootStatus: 'Pending',
			boot: { auto: true, required: true, retryOnPending: false },
		});
		await harness.ready();
		await call(harness, 'gmon-pre-setup', 'SetVariableMonitoring', {
			setMonitoringData: [monitorData()],
		});
		expect(await call(harness, 'gmon-pre', 'GetMonitoringReport', { requestId: 9 })).toEqual({
			status: 'Accepted',
		});
		expect(harness.calls('NotifyMonitoringReport')).toHaveLength(0);
		expect(
			harness.simulator.getQueue().some((entry) => entry.action === 'NotifyMonitoringReport'),
		).toBe(true);
	});

	it('builds device-model reports with filters', async () => {
		const harness = createHarness201();
		await harness.ready();
		expect(await call(harness, 'grep-1', 'GetReport', { requestId: 1 })).toEqual({
			status: 'Accepted',
		});
		const report = harness
			.calls('NotifyReport')
			.map((frame) => frame[3] as Record<string, unknown>)
			.at(-1);
		const rows = report?.['reportData'] as Array<Record<string, unknown>>;
		expect(rows.length).toBeGreaterThan(0);
		expect(rows[0]?.['variableCharacteristics']).toMatchObject({
			supportsMonitoring: true,
		});
		expect(
			await call(harness, 'grep-2', 'GetReport', {
				requestId: 2,
				componentVariable: [
					{
						component: { name: 'OCPPCommCtrlr' },
						variable: { name: 'HeartbeatInterval' },
					},
				],
			}),
		).toEqual({ status: 'Accepted' });
		const filtered = harness
			.calls('NotifyReport')
			.map((frame) => frame[3] as Record<string, unknown>)
			.at(-1);
		expect(filtered?.['reportData']).toHaveLength(1);
		expect(
			await call(harness, 'grep-3', 'GetReport', {
				requestId: 3,
				componentVariable: [
					{
						component: { name: 'OCPPCommCtrlr' },
						variable: { name: 'Nope' },
					},
				],
			}),
		).toEqual({ status: 'EmptyResultSet' });
		expect(
			await call(harness, 'grep-4', 'GetReport', {
				requestId: 4,
				componentCriteria: ['Enabled'],
			}),
		).toEqual({ status: 'NotSupported' });
		expect(await call(harness, 'grep-5', 'GetReport', {})).toEqual({ status: 'Rejected' });
		expect(
			(
				await errorCall(harness, 'grep-6', 'GetReport', {
					requestId: 1,
					componentCriteria: [],
				})
			).slice(0, 3),
		).toEqual([4, 'grep-6', 'FormatViolation']);
		expect(
			(
				await errorCall(harness, 'grep-7', 'GetReport', {
					requestId: 1,
					componentVariable: [],
				})
			).slice(0, 3),
		).toEqual([4, 'grep-7', 'FormatViolation']);
		expect(
			await call(harness, 'grep-8', 'GetReport', {
				requestId: 8,
				componentVariable: [{ component: { name: 'OCPPCommCtrlr', instance: 'other' } }],
			}),
		).toEqual({ status: 'EmptyResultSet' });
		expect(
			await call(harness, 'grep-9', 'GetReport', {
				requestId: 9,
				componentVariable: [
					{
						component: { name: 'OCPPCommCtrlr', evse: { id: 1 } },
						variable: { name: 'HeartbeatInterval' },
					},
				],
			}),
		).toEqual({ status: 'EmptyResultSet' });
	});

	it('validates and stores network profiles', async () => {
		const harness = createHarness201();
		await harness.ready();
		const connection = {
			ocppVersion: 'OCPP20',
			ocppTransport: 'JSON',
			ocppCsmsUrl: 'wss://csms.example.com/CP201',
			messageTimeout: 30,
			securityProfile: 1,
			ocppInterface: 'Wired0',
		};
		expect(
			await call(harness, 'net-1', 'SetNetworkProfile', {
				configurationSlot: 1,
				connectionData: connection,
			}),
		).toEqual({ status: 'Accepted' });
		expect(harness.simulator.state.networkProfiles).toHaveLength(1);
		expect(harness.simulator.state.networkProfiles[0]?.connectionData).toEqual(connection);
		await call(harness, 'net-2', 'SetNetworkProfile', {
			configurationSlot: 1,
			connectionData: { ...connection, messageTimeout: 60 },
		});
		expect(harness.simulator.state.networkProfiles).toHaveLength(1);
		expect(harness.simulator.state.networkProfiles[0]?.connectionData['messageTimeout']).toBe(60);
		expect(
			await call(harness, 'net-3', 'SetNetworkProfile', {
				configurationSlot: 3,
				connectionData: connection,
			}),
		).toEqual({ status: 'Rejected' });
		expect(
			await call(harness, 'net-4', 'SetNetworkProfile', {
				configurationSlot: 1,
				connectionData: { ...connection, ocppTransport: 'SOAP' },
			}),
		).toEqual({ status: 'Rejected' });
		expect(
			await call(harness, 'net-5', 'SetNetworkProfile', {
				configurationSlot: 1,
				connectionData: { ...connection, ocppCsmsUrl: 'http://bad' },
			}),
		).toEqual({ status: 'Rejected' });
		expect(
			(
				await errorCall(harness, 'net-6', 'SetNetworkProfile', {
					connectionData: connection,
				})
			).slice(0, 3),
		).toEqual([4, 'net-6', 'FormatViolation']);
		expect(await call(harness, 'net-7', 'SetNetworkProfile', { configurationSlot: 1 })).toEqual({
			status: 'Rejected',
		});
		expect(
			await call(harness, 'net-8', 'SetNetworkProfile', {
				configurationSlot: 1,
				connectionData: { ...connection, ocppVersion: 'BOGUS' },
			}),
		).toEqual({ status: 'Rejected' });
		expect(
			await call(harness, 'net-9', 'SetNetworkProfile', {
				configurationSlot: 1,
				connectionData: { ...connection, ocppInterface: 'Wired9' },
			}),
		).toEqual({ status: 'Rejected' });
		expect(
			await call(harness, 'net-10', 'SetNetworkProfile', {
				configurationSlot: 2,
				connectionData: { ...connection, apn: { apn: 'internet', apnAuthentication: 'PAP' } },
			}),
		).toEqual({ status: 'Accepted' });
		expect(
			await call(harness, 'net-11', 'SetNetworkProfile', {
				configurationSlot: 2,
				connectionData: { ...connection, apn: { apn: '', apnAuthentication: 'PAP' } },
			}),
		).toEqual({ status: 'Rejected' });
		expect(
			await call(harness, 'net-12', 'SetNetworkProfile', {
				configurationSlot: 0,
				connectionData: {
					...connection,
					vpn: { server: 'vpn', user: 'u', password: 'p', key: 'k', type: 'IKEv2' },
				},
			}),
		).toEqual({ status: 'Accepted' });
		expect(
			await call(harness, 'net-13', 'SetNetworkProfile', {
				configurationSlot: 0,
				connectionData: {
					...connection,
					vpn: { server: 'vpn', user: 'u', password: 'p', key: 'k', type: 'BOGUS' },
				},
			}),
		).toEqual({ status: 'Rejected' });
		expect(
			await call(harness, 'net-14', 'SetNetworkProfile', {
				configurationSlot: -1,
				connectionData: connection,
			}),
		).toEqual({ status: 'Rejected' });
	});

	it('sends NotifyEvent messages with per-message sequence numbers', async () => {
		const harness = createHarness201();
		await harness.ready();
		await harness.simulator.sendNotifyEvent('OCPPCommCtrlr', 'HeartbeatInterval', '50');
		await harness.simulator.sendNotifyEvent('OCPPCommCtrlr', 'HeartbeatInterval', '60', 'Periodic');
		const events = harness.calls('NotifyEvent').map((frame) => frame[3] as Record<string, unknown>);
		expect(events).toHaveLength(2);
		expect(events[0]).toMatchObject({ seqNo: 0, tbc: false });
		expect(events[1]).toMatchObject({ seqNo: 0, tbc: false });
		const first = (events[0]!['eventData'] as Array<Record<string, unknown>>)[0]!;
		expect(first).toMatchObject({
			eventId: 1,
			trigger: 'Alerting',
			actualValue: '50',
			eventNotificationType: 'HardWiredNotification',
			component: { name: 'OCPPCommCtrlr' },
			variable: { name: 'HeartbeatInterval' },
		});
		expect(first['severity']).toBeUndefined();
		expect((events[1]!['eventData'] as Array<Record<string, unknown>>)[0]).toMatchObject({
			eventId: 2,
			trigger: 'Periodic',
		});
	});

	it('evaluates threshold, delta, level, and transaction monitors', async () => {
		const harness = createHarness201();
		await harness.ready();
		await call(harness, 'eval-setup', 'SetVariableMonitoring', {
			setMonitoringData: [
				monitorData({ value: 40, severity: 2 }),
				monitorData({
					type: 'LowerThreshold',
					value: 20,
					severity: 3,
				}),
				monitorData({
					type: 'Delta',
					value: 10,
					severity: 1,
					component: { name: 'SampledDataCtrlr' },
					variable: { name: 'TxUpdatedInterval' },
				}),
			],
		});
		const setVariable = (id: string, variable: string, value: string) =>
			call(harness, id, 'SetVariables', {
				setVariableData: [
					{
						component: {
							name: variable === 'HeartbeatInterval' ? 'OCPPCommCtrlr' : 'SampledDataCtrlr',
						},
						variable: { name: variable },
						attributeValue: value,
					},
				],
			});
		await setVariable('eval-0', 'HeartbeatInterval', '30');
		await setVariable('eval-1', 'HeartbeatInterval', '50');
		expect(harness.calls('NotifyEvent')).toHaveLength(1);
		const alert = harness.calls('NotifyEvent')[0]![3] as Record<string, unknown>;
		expect((alert['eventData'] as Array<Record<string, unknown>>)[0]).toMatchObject({
			trigger: 'Alerting',
			actualValue: '50',
			variableMonitoringId: 1,
		});
		await setVariable('eval-2', 'HeartbeatInterval', '60');
		expect(harness.calls('NotifyEvent')).toHaveLength(1);
		await setVariable('eval-3', 'HeartbeatInterval', '30');
		expect(harness.calls('NotifyEvent')).toHaveLength(2);
		const cleared = harness.calls('NotifyEvent')[1]![3] as Record<string, unknown>;
		expect((cleared['eventData'] as Array<Record<string, unknown>>)[0]).toMatchObject({
			cleared: true,
			actualValue: '30',
		});
		await setVariable('eval-4', 'HeartbeatInterval', '10');
		expect(harness.calls('NotifyEvent')).toHaveLength(3);
		await setVariable('eval-5', 'HeartbeatInterval', '25');
		expect(harness.calls('NotifyEvent')).toHaveLength(4);
		const lowerCleared = harness.calls('NotifyEvent')[3]![3] as Record<string, unknown>;
		expect((lowerCleared['eventData'] as Array<Record<string, unknown>>)[0]).toMatchObject({
			cleared: true,
		});

		await call(harness, 'eval-level', 'SetMonitoringLevel', { severity: 0 });
		await setVariable('eval-6', 'HeartbeatInterval', '100');
		expect(harness.calls('NotifyEvent')).toHaveLength(4);

		await call(harness, 'eval-setup-2', 'SetVariableMonitoring', {
			setMonitoringData: [monitorData({ value: 400, severity: 0, transaction: true })],
		});
		await setVariable('eval-7', 'HeartbeatInterval', '200');
		const beforeTransaction = harness.calls('NotifyEvent').length;
		await harness.simulator.startChargingSession(1, 'A');
		await setVariable('eval-8', 'HeartbeatInterval', '500');
		expect(harness.calls('NotifyEvent').length).toBe(beforeTransaction + 1);
	});

	it('evaluates delta monitors from the last reported value', async () => {
		const harness = createHarness201();
		await harness.ready();
		await call(harness, 'delta-setup', 'SetVariableMonitoring', {
			setMonitoringData: [
				monitorData({
					type: 'Delta',
					value: 10,
					severity: 1,
					component: { name: 'SampledDataCtrlr' },
					variable: { name: 'TxUpdatedInterval' },
				}),
			],
		});
		const set = (id: string, value: string) =>
			call(harness, id, 'SetVariables', {
				setVariableData: [
					{
						component: { name: 'SampledDataCtrlr' },
						variable: { name: 'TxUpdatedInterval' },
						attributeValue: value,
					},
				],
			});
		await set('delta-1', '40');
		expect(harness.calls('NotifyEvent')).toHaveLength(0);
		await set('delta-2', '45');
		expect(harness.calls('NotifyEvent')).toHaveLength(0);
		await set('delta-3', '60');
		expect(harness.calls('NotifyEvent')).toHaveLength(1);
		const event = harness.calls('NotifyEvent')[0]![3] as Record<string, unknown>;
		expect((event['eventData'] as Array<Record<string, unknown>>)[0]).toMatchObject({
			trigger: 'Delta',
			actualValue: '60',
		});
		await set('delta-4', '65');
		expect(harness.calls('NotifyEvent')).toHaveLength(1);
		await set('delta-5', '80');
		expect(harness.calls('NotifyEvent')).toHaveLength(2);
	});

	it('uses the reject mode for simple device-model commands', async () => {
		const harness = createHarness201();
		await harness.ready();
		harness.simulator.setInboundResponseMode('reject');
		expect(
			await call(harness, 'dm-reject-1', 'SetMonitoringBase', { monitoringBase: 'All' }),
		).toEqual({ status: 'Rejected' });
		expect(await call(harness, 'dm-reject-2', 'SetMonitoringLevel', { severity: 1 })).toEqual({
			status: 'Rejected',
		});
		expect(await call(harness, 'dm-reject-3', 'GetMonitoringReport', { requestId: 1 })).toEqual({
			status: 'Rejected',
		});
		expect(await call(harness, 'dm-reject-4', 'GetReport', { requestId: 1 })).toEqual({
			status: 'Rejected',
		});
		expect(
			await call(harness, 'dm-reject-5', 'SetNetworkProfile', {
				configurationSlot: 1,
				connectionData: {},
			}),
		).toEqual({ status: 'Rejected' });
	});
});
