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

describe('Simulator201 inbound commands', () => {
	it('accepts and runs RequestStartTransaction, then RequestStopTransaction', async () => {
		const harness = createHarness201();
		await harness.ready();
		const start = await call(harness, 'start-1', 'RequestStartTransaction', {
			evseId: 1,
			remoteStartId: 7,
			idToken: { idToken: 'REMOTE', type: 'Central' },
		});
		expect(start['status']).toBe('Accepted');
		expect(typeof start['transactionId']).toBe('string');
		const transactionId = String(start['transactionId']);
		const started = harness
			.calls('TransactionEvent')
			.map((frame) => frame[3] as Record<string, unknown>)
			.find((payload) => payload['eventType'] === 'Started');
		expect(started?.['triggerReason']).toBe('RemoteStart');
		expect(started?.['transactionInfo']).toMatchObject({ remoteStartId: 7 });
		expect(started?.['idToken']).toEqual({ idToken: 'REMOTE', type: 'Central' });
		expect(harness.simulator.getEvse(1)?.status).toBe('Occupied');

		const stop = await call(harness, 'stop-1', 'RequestStopTransaction', { transactionId });
		expect(stop).toEqual({ status: 'Accepted' });
		expect(harness.simulator.getEvse(1)?.transaction).toBeNull();
		expect(harness.simulator.getState().completedTransactions).toHaveLength(1);
	});

	it('rejects malformed and occupied remote starts', async () => {
		const harness = createHarness201();
		await harness.ready();
		expect(
			await call(harness, 'start-a', 'RequestStartTransaction', {
				evseId: 1,
				idToken: { idToken: 'A', type: 'ISO14443' },
			}),
		).toEqual({ status: 'Rejected' });
		expect(
			await call(harness, 'start-b', 'RequestStartTransaction', {
				evseId: 1,
				remoteStartId: 1,
			}),
		).toEqual({ status: 'Rejected' });
		expect(
			await call(harness, 'start-c', 'RequestStartTransaction', {
				evseId: 99,
				remoteStartId: 1,
				idToken: { idToken: 'A', type: 'ISO14443' },
			}),
		).toEqual({ status: 'Rejected' });
		const accepted = await call(harness, 'start-d', 'RequestStartTransaction', {
			remoteStartId: 2,
			idToken: { idToken: 'A', type: 'UnknownType' },
		});
		expect(accepted['status']).toBe('Accepted');
		expect(
			await call(harness, 'start-e', 'RequestStartTransaction', {
				evseId: 1,
				remoteStartId: 3,
				idToken: { idToken: 'A', type: 'ISO14443' },
			}),
		).toEqual({ status: 'Rejected' });
	});

	it('rejects unknown remote stops', async () => {
		const harness = createHarness201();
		await harness.ready();
		expect(await call(harness, 'stop-a', 'RequestStopTransaction', {})).toEqual({
			status: 'Rejected',
		});
		expect(
			await call(harness, 'stop-b', 'RequestStopTransaction', { transactionId: 'missing' }),
		).toEqual({ status: 'Rejected' });
	});

	it('handles Reset variants', async () => {
		const harness = createHarness201();
		await harness.ready();
		expect(await call(harness, 'reset-a', 'Reset', { type: 'Nope' })).toEqual({
			status: 'Rejected',
		});
		await harness.simulator.startChargingSession(1, 'A');
		expect(await call(harness, 'reset-c', 'Reset', { type: 'OnIdle' })).toEqual({
			status: 'Scheduled',
		});
		expect(harness.simulator.getEvse(1)?.transaction).not.toBeNull();
		expect(await call(harness, 'reset-d', 'Reset', { type: 'Immediate' })).toEqual({
			status: 'Accepted',
		});
		expect(harness.simulator.getEvse(1)?.transaction).toBeNull();
		const ended = harness
			.calls('TransactionEvent')
			.map((frame) => frame[3] as Record<string, unknown>)
			.filter((payload) => payload['eventType'] === 'Ended');
		expect(ended.at(-1)?.['transactionInfo']).toMatchObject({
			stoppedReason: 'ImmediateReset',
		});
	});

	it('executes a scheduled OnIdle reset after the transaction ends', async () => {
		const harness = createHarness201();
		await harness.ready();
		await harness.simulator.startChargingSession(1, 'A');
		const notices: string[] = [];
		harness.simulator.on('notice', (event) => {
			notices.push(event.message);
		});
		expect(await call(harness, 'reset-idle', 'Reset', { type: 'OnIdle' })).toEqual({
			status: 'Scheduled',
		});
		expect(harness.simulator.state.pendingResets.station).toBe(true);
		await harness.simulator.stopTransaction(1);
		expect(harness.simulator.state.pendingResets.station).toBe(false);
		expect(notices).toContain('Scheduled reset executed');
	});

	it('keeps independent OnIdle resets and executes idle resets immediately', async () => {
		const harness = createHarness201();
		await harness.ready();
		await harness.simulator.startChargingSession(1, 'A');
		await harness.simulator.startChargingSession(2, 'B');
		const notices: string[] = [];
		harness.simulator.on('notice', (event) => {
			notices.push(event.message);
		});
		expect(await call(harness, 'reset-evse-1', 'Reset', { type: 'OnIdle', evseId: 1 })).toEqual({
			status: 'Scheduled',
		});
		expect(await call(harness, 'reset-evse-2', 'Reset', { type: 'OnIdle', evseId: 2 })).toEqual({
			status: 'Scheduled',
		});
		expect(harness.simulator.state.pendingResets.evseIds).toEqual([1, 2]);
		await harness.simulator.stopTransaction(1);
		expect(harness.simulator.state.pendingResets.evseIds).toEqual([2]);
		expect(notices).toHaveLength(1);
		await harness.simulator.stopTransaction(2);
		expect(harness.simulator.state.pendingResets.evseIds).toHaveLength(0);
		expect(notices).toHaveLength(2);
	});

	it('sends only implemented TriggerMessage notifications', async () => {
		const harness = createHarness201();
		await harness.ready();
		const heartbeatBefore = harness.calls('Heartbeat').length;
		expect(
			await call(harness, 'trig-1', 'TriggerMessage', { requestedMessage: 'Heartbeat' }),
		).toEqual({ status: 'Accepted' });
		expect(harness.calls('Heartbeat').length).toBe(heartbeatBefore + 1);
		const statusBefore = harness.calls('StatusNotification').length;
		expect(
			await call(harness, 'trig-2', 'TriggerMessage', {
				requestedMessage: 'StatusNotification',
			}),
		).toEqual({ status: 'Accepted' });
		expect(harness.calls('StatusNotification').length).toBeGreaterThan(statusBefore);
		const bootBefore = harness.calls('BootNotification').length;
		expect(
			await call(harness, 'trig-3', 'TriggerMessage', {
				requestedMessage: 'BootNotification',
			}),
		).toEqual({ status: 'Rejected' });
		expect(harness.calls('BootNotification').length).toBe(bootBefore);
		expect(
			await call(harness, 'trig-4', 'TriggerMessage', {
				requestedMessage: 'TransactionEvent',
			}),
		).toEqual({ status: 'Rejected' });
		expect(
			await call(harness, 'trig-5', 'TriggerMessage', {
				requestedMessage: 'MeterValues',
			}),
		).toEqual({ status: 'Accepted' });
		await harness.simulator.startChargingSession(1, 'A');
		expect(
			await call(harness, 'trig-6', 'TriggerMessage', {
				requestedMessage: 'TransactionEvent',
				evse: { id: 2 },
			}),
		).toEqual({ status: 'Rejected' });
		expect(
			await call(harness, 'trig-7', 'TriggerMessage', {
				requestedMessage: 'TransactionEvent',
				evse: { id: 1 },
			}),
		).toEqual({ status: 'Accepted' });
		expect(
			await call(harness, 'trig-8', 'TriggerMessage', {
				requestedMessage: 'TransactionEvent',
			}),
		).toEqual({ status: 'Accepted' });
		const trigger = harness
			.calls('TransactionEvent')
			.map((frame) => frame[3] as Record<string, unknown>)
			.filter((payload) => payload['triggerReason'] === 'Trigger');
		expect(trigger.length).toBeGreaterThanOrEqual(2);
	});

	it('triggers a boot only when the current boot is not accepted', async () => {
		const harness = createHarness201({
			bootStatus: 'Pending',
			boot: { auto: true, required: true, retryOnPending: false },
		});
		await harness.ready();
		expect(harness.simulator.getState().boot.status).toBe('pending');
		expect(
			await call(harness, 'trig-boot-1', 'TriggerMessage', {
				requestedMessage: 'BootNotification',
			}),
		).toEqual({ status: 'Accepted' });
		const boots = harness.calls('BootNotification');
		expect(boots).toHaveLength(2);
		expect((boots[1]![3] as Record<string, unknown>)['reason']).toBe('Triggered');
	});

	it('triggers every active EVSE when evse is omitted', async () => {
		const harness = createHarness201();
		await harness.ready();
		await harness.simulator.startChargingSession(1, 'A');
		await harness.simulator.startChargingSession(2, 'B');
		const before = harness
			.calls('TransactionEvent')
			.map((frame) => frame[3] as Record<string, unknown>)
			.filter((payload) => payload['triggerReason'] === 'Trigger').length;
		expect(
			await call(harness, 'trig-all', 'TriggerMessage', {
				requestedMessage: 'TransactionEvent',
			}),
		).toEqual({ status: 'Accepted' });
		const after = harness
			.calls('TransactionEvent')
			.map((frame) => frame[3] as Record<string, unknown>)
			.filter((payload) => payload['triggerReason'] === 'Trigger').length;
		expect(after - before).toBe(2);
	});

	it('applies immediate and scheduled availability changes', async () => {
		const harness = createHarness201();
		await harness.ready();
		expect(
			await call(harness, 'avail-a', 'ChangeAvailability', {
				operationalStatus: 'Nope',
			}),
		).toEqual({ status: 'Rejected' });
		expect(
			await call(harness, 'avail-b', 'ChangeAvailability', {
				operationalStatus: 'Inoperative',
				evse: { id: 99 },
			}),
		).toEqual({ status: 'Rejected' });
		expect(
			await call(harness, 'avail-c', 'ChangeAvailability', {
				operationalStatus: 'Inoperative',
				evse: { id: 1, connectorId: 2 },
			}),
		).toEqual({ status: 'Rejected' });
		expect(
			await call(harness, 'avail-d', 'ChangeAvailability', {
				operationalStatus: 'Inoperative',
				evse: { id: 1, connectorId: 1 },
			}),
		).toEqual({ status: 'Accepted' });
		expect(harness.simulator.getEvse(1)?.status).toBe('Unavailable');
		expect(
			await call(harness, 'avail-e', 'ChangeAvailability', {
				operationalStatus: 'Operative',
				evse: { id: 1 },
			}),
		).toEqual({ status: 'Accepted' });
		expect(harness.simulator.getEvse(1)?.status).toBe('Available');

		await harness.simulator.startChargingSession(1, 'A');
		expect(
			await call(harness, 'avail-f', 'ChangeAvailability', {
				operationalStatus: 'Inoperative',
				evse: { id: 1 },
			}),
		).toEqual({ status: 'Scheduled' });
		expect(harness.simulator.getEvse(1)?.status).toBe('Occupied');
		expect(
			await call(harness, 'avail-f2', 'ChangeAvailability', {
				operationalStatus: 'Operative',
				evse: { id: 1 },
			}),
		).toEqual({ status: 'Accepted' });
		expect(harness.simulator.getEvse(1)?.pendingOperational).toBeNull();
		await harness.simulator.stopTransaction(1);
		expect(harness.simulator.getEvse(1)?.status).toBe('Available');
		await harness.simulator.startChargingSession(1, 'A');
		expect(
			await call(harness, 'avail-f3', 'ChangeAvailability', {
				operationalStatus: 'Inoperative',
				evse: { id: 1 },
			}),
		).toEqual({ status: 'Scheduled' });
		await harness.simulator.stopTransaction(1);
		expect(harness.simulator.getEvse(1)?.status).toBe('Unavailable');
		expect(harness.simulator.getEvse(1)?.operational).toBe('Inoperative');
		expect(
			await call(harness, 'avail-g', 'ChangeAvailability', {
				operationalStatus: 'Inoperative',
				evse: { id: 1 },
			}),
		).toEqual({ status: 'Accepted' });
		expect(
			await call(harness, 'avail-h', 'ChangeAvailability', {
				operationalStatus: 'Operative',
				evse: { id: 1 },
			}),
		).toEqual({ status: 'Accepted' });
		expect(harness.simulator.getEvse(1)?.status).toBe('Available');

		harness.simulator.setEvseStatus(2, 'Reserved');
		await call(harness, 'avail-i', 'ChangeAvailability', {
			operationalStatus: 'Inoperative',
			evse: { id: 2 },
		});
		expect(harness.simulator.getEvse(2)?.status).toBe('Unavailable');
		await call(harness, 'avail-j', 'ChangeAvailability', {
			operationalStatus: 'Operative',
			evse: { id: 2 },
		});
		expect(harness.simulator.getEvse(2)?.status).toBe('Reserved');

		harness.simulator.setEvseStatus(2, 'Faulted');
		await call(harness, 'avail-k', 'ChangeAvailability', {
			operationalStatus: 'Inoperative',
			evse: { id: 2 },
		});
		expect(harness.simulator.getEvse(2)?.status).toBe('Faulted');
		await call(harness, 'avail-l', 'ChangeAvailability', {
			operationalStatus: 'Operative',
			evse: { id: 2 },
		});
		expect(harness.simulator.getEvse(2)?.status).toBe('Faulted');
	});

	it('cancels stale station-wide pending availability changes', async () => {
		const harness = createHarness201();
		await harness.ready();
		await harness.simulator.startChargingSession(1, 'A');
		expect(
			await call(harness, 'mixed-1', 'ChangeAvailability', {
				operationalStatus: 'Inoperative',
				evse: { id: 1 },
			}),
		).toEqual({ status: 'Scheduled' });
		expect(harness.simulator.getEvse(1)?.pendingOperational).toBe('Inoperative');
		await call(harness, 'mixed-2', 'ChangeAvailability', {
			operationalStatus: 'Inoperative',
			evse: { id: 2 },
		});
		expect(harness.simulator.getEvse(2)?.operational).toBe('Inoperative');
		expect(
			await call(harness, 'mixed-3', 'ChangeAvailability', {
				operationalStatus: 'Operative',
			}),
		).toEqual({ status: 'Scheduled' });
		expect(harness.simulator.getEvse(1)?.pendingOperational).toBeNull();
		expect(harness.simulator.getEvse(2)?.pendingOperational).toBe('Operative');
		await harness.simulator.stopTransaction(1);
		expect(harness.simulator.getEvse(1)?.status).toBe('Available');
		expect(harness.simulator.getEvse(2)?.status).toBe('Available');
		expect(harness.simulator.getEvse(2)?.operational).toBe('Operative');
	});

	it('unlocks only idle known connectors', async () => {
		const harness = createHarness201();
		await harness.ready();
		expect(await call(harness, 'unlock-a', 'UnlockConnector', {})).toEqual({
			status: 'UnknownConnector',
		});
		expect(
			await call(harness, 'unlock-b', 'UnlockConnector', { evseId: 99, connectorId: 1 }),
		).toEqual({ status: 'UnknownConnector' });
		expect(
			await call(harness, 'unlock-c', 'UnlockConnector', { evseId: 1, connectorId: 2 }),
		).toEqual({ status: 'UnknownConnector' });
		expect(
			await call(harness, 'unlock-d', 'UnlockConnector', { evseId: 1, connectorId: 1 }),
		).toEqual({ status: 'Unlocked' });
		await harness.simulator.startChargingSession(1, 'A');
		expect(
			await call(harness, 'unlock-e', 'UnlockConnector', { evseId: 1, connectorId: 1 }),
		).toEqual({ status: 'OngoingAuthorizedTransaction' });
	});

	it('answers cache and data transfer honestly', async () => {
		const harness = createHarness201();
		await harness.ready();
		expect(await call(harness, 'cache-1', 'ClearCache', {})).toEqual({
			status: 'Accepted',
		});
		expect(
			await call(harness, 'data-1', 'DataTransfer', { vendorId: 'acme', messageId: 'x' }),
		).toEqual({ status: 'UnknownVendorId' });
		const missing = await errorCall(harness, 'data-2', 'DataTransfer', {});
		expect(missing[0]).toBe(4);
		expect(missing[2]).toBe('FormatViolation');
	});

	it('reads variables with attribute semantics', async () => {
		const harness = createHarness201();
		await harness.ready();
		const known = await call(harness, 'getvar-1', 'GetVariables', {
			getVariableData: [
				{
					component: { name: 'OCPPCommCtrlr', instance: 'main', evse: { id: 1 } },
					variable: { name: 'HeartbeatInterval', instance: 'x' },
				},
			],
		});
		expect(known).toMatchObject({
			getVariableResult: [
				expect.objectContaining({
					attributeStatus: 'Accepted',
					attributeType: 'Actual',
					attributeValue: '60',
					component: { name: 'OCPPCommCtrlr', instance: 'main', evse: { id: 1 } },
					variable: { name: 'HeartbeatInterval', instance: 'x' },
				}),
			],
		});
		expect(
			await call(harness, 'getvar-2', 'GetVariables', {
				getVariableData: [{ component: { name: 'OCPPCommCtrlr' }, variable: { name: 'Nope' } }],
			}),
		).toMatchObject({ getVariableResult: [{ attributeStatus: 'UnknownVariable' }] });
		expect(
			await call(harness, 'getvar-3', 'GetVariables', {
				getVariableData: [{ component: { name: 'Nope' }, variable: { name: 'X' } }],
			}),
		).toMatchObject({ getVariableResult: [{ attributeStatus: 'UnknownComponent' }] });
		expect(
			await call(harness, 'getvar-4', 'GetVariables', {
				getVariableData: [
					{
						component: { name: 'OCPPCommCtrlr' },
						variable: { name: 'HeartbeatInterval' },
						attributeType: 'Target',
					},
				],
			}),
		).toMatchObject({ getVariableResult: [{ attributeStatus: 'NotSupportedAttributeType' }] });
		expect(
			await call(harness, 'getvar-5', 'GetVariables', {
				getVariableData: [{ variable: { name: 'X' } }],
			}),
		).toMatchObject({ getVariableResult: [{ attributeStatus: 'UnknownComponent' }] });
		const empty = await errorCall(harness, 'getvar-6', 'GetVariables', {
			getVariableData: [],
		});
		expect(empty[2]).toBe('FormatViolation');
		const filtered = await errorCall(harness, 'getvar-7', 'GetVariables', {
			getVariableData: ['bad'],
		});
		expect(filtered[2]).toBe('FormatViolation');
		const badAttribute = await errorCall(harness, 'getvar-8', 'GetVariables', {
			getVariableData: [
				{
					component: { name: 'OCPPCommCtrlr' },
					variable: { name: 'HeartbeatInterval' },
					attributeType: 'Bogus',
				},
			],
		});
		expect(badAttribute[2]).toBe('FormatViolation');
	});

	it('writes variables and applies intervals', async () => {
		const harness = createHarness201();
		await harness.ready();
		const heartbeat = await call(harness, 'setvar-1', 'SetVariables', {
			setVariableData: [
				{
					component: { name: 'OCPPCommCtrlr' },
					variable: { name: 'HeartbeatInterval' },
					attributeValue: '30',
				},
			],
		});
		expect(heartbeat).toMatchObject({
			setVariableResult: [{ attributeStatus: 'Accepted', attributeType: 'Actual' }],
		});
		expect(harness.simulator.getHeartbeatIntervalMs()).toBe(30_000);
		const meter = await call(harness, 'setvar-2', 'SetVariables', {
			setVariableData: [
				{
					component: { name: 'SampledDataCtrlr' },
					variable: { name: 'TxUpdatedInterval' },
					attributeValue: '10',
				},
			],
		});
		expect(meter).toMatchObject({ setVariableResult: [{ attributeStatus: 'Accepted' }] });
		expect(harness.simulator.getMeterValueIntervalMs()).toBe(10_000);
		await harness.simulator.startChargingSession(1, 'A');
		await call(harness, 'setvar-3', 'SetVariables', {
			setVariableData: [
				{
					component: { name: 'SampledDataCtrlr' },
					variable: { name: 'TxUpdatedInterval' },
					attributeValue: '20',
				},
			],
		});
		expect(harness.simulator.getMeterValueIntervalMs()).toBe(20_000);
		expect(
			await call(harness, 'setvar-4', 'SetVariables', {
				setVariableData: [
					{
						component: { name: 'OCPPCommCtrlr' },
						variable: { name: 'Nope' },
						attributeValue: '1',
					},
				],
			}),
		).toMatchObject({ setVariableResult: [{ attributeStatus: 'UnknownVariable' }] });
		expect(
			await call(harness, 'setvar-5', 'SetVariables', {
				setVariableData: [
					{
						component: { name: 'Nope' },
						variable: { name: 'X' },
						attributeValue: '1',
					},
				],
			}),
		).toMatchObject({ setVariableResult: [{ attributeStatus: 'UnknownComponent' }] });
		expect(
			await call(harness, 'setvar-6', 'SetVariables', {
				setVariableData: [
					{
						component: { name: 'OCPPCommCtrlr' },
						variable: { name: 'HeartbeatInterval' },
						attributeValue: '1',
						attributeType: 'Target',
					},
				],
			}),
		).toMatchObject({
			setVariableResult: [{ attributeStatus: 'NotSupportedAttributeType' }],
		});
		expect(
			await call(harness, 'setvar-7', 'SetVariables', {
				setVariableData: [
					{
						component: { name: 'OCPPCommCtrlr' },
						variable: { name: 'HeartbeatInterval' },
						attributeValue: 1,
					},
				],
			}),
		).toMatchObject({ setVariableResult: [{ attributeStatus: 'Rejected' }] });
		const badHeartbeat = await call(harness, 'setvar-8', 'SetVariables', {
			setVariableData: [
				{
					component: { name: 'OCPPCommCtrlr' },
					variable: { name: 'HeartbeatInterval' },
					attributeValue: 'bad',
				},
			],
		});
		expect(badHeartbeat).toMatchObject({
			setVariableResult: [{ attributeStatus: 'Rejected' }],
		});
		expect(harness.simulator.getHeartbeatIntervalMs()).toBe(30_000);
		const badMeter = await call(harness, 'setvar-9', 'SetVariables', {
			setVariableData: [
				{
					component: { name: 'SampledDataCtrlr' },
					variable: { name: 'TxUpdatedInterval' },
					attributeValue: '0',
				},
			],
		});
		expect(badMeter).toMatchObject({ setVariableResult: [{ attributeStatus: 'Rejected' }] });
		expect(harness.simulator.getMeterValueIntervalMs()).toBe(20_000);
		expect(
			await call(harness, 'setvar-10', 'SetVariables', {
				setVariableData: [
					{
						component: { name: 'DeviceDataCtrlr' },
						variable: { name: 'Enabled' },
						attributeValue: 'not-a-boolean',
					},
				],
			}),
		).toMatchObject({ setVariableResult: [{ attributeStatus: 'Rejected' }] });
		const empty = await errorCall(harness, 'setvar-11', 'SetVariables', {
			setVariableData: [],
		});
		expect(empty[2]).toBe('FormatViolation');
		const mixed = await errorCall(harness, 'setvar-12', 'SetVariables', {
			setVariableData: [
				{
					component: { name: 'OCPPCommCtrlr' },
					variable: { name: 'HeartbeatInterval' },
					attributeValue: '30',
				},
				'bad',
			],
		});
		expect(mixed[2]).toBe('FormatViolation');
		const badAttribute = await errorCall(harness, 'setvar-13', 'SetVariables', {
			setVariableData: [
				{
					component: { name: 'OCPPCommCtrlr' },
					variable: { name: 'HeartbeatInterval' },
					attributeValue: '30',
					attributeType: 'Bogus',
				},
			],
		});
		expect(badAttribute[2]).toBe('FormatViolation');
	});

	it('builds base reports and handles unsupported bases', async () => {
		const harness = createHarness201();
		await harness.ready();
		const accepted = await call(harness, 'report-1', 'GetBaseReport', {
			requestId: 42,
			reportBase: 'FullInventory',
		});
		expect(accepted).toEqual({ status: 'Accepted' });
		const notify = harness
			.calls('NotifyReport')
			.map((frame) => frame[3] as Record<string, unknown>);
		expect(notify).toHaveLength(1);
		expect(notify[0]).toMatchObject({
			requestId: 42,
			seqNo: 0,
			tbc: false,
		});
		expect((notify[0]!['reportData'] as unknown[]).length).toBeGreaterThan(0);
		expect(
			(notify[0]!['reportData'] as Array<Record<string, unknown>>)[0]!['variableCharacteristics'],
		).toMatchObject({ dataType: 'integer', supportsMonitoring: true });
		expect(
			await call(harness, 'report-2', 'GetBaseReport', {
				requestId: 1,
				reportBase: 'Nope',
			}),
		).toEqual({ status: 'NotSupported' });
		expect(
			await call(harness, 'report-3', 'GetBaseReport', {
				requestId: 'x',
				reportBase: 'FullInventory',
			}),
		).toEqual({ status: 'Rejected' });
		expect(
			await call(harness, 'report-4', 'GetBaseReport', {
				requestId: 2,
				reportBase: 'SummaryInventory',
			}),
		).toEqual({ status: 'Accepted' });
		const summary = harness
			.calls('NotifyReport')
			.map((frame) => frame[3] as Record<string, unknown>)
			.at(-1);
		expect(
			(summary?.['reportData'] as Array<Record<string, unknown>>)[0]!['variableCharacteristics'],
		).toBeUndefined();
		harness.simulator.state.variables = {};
		expect(
			await call(harness, 'report-5', 'GetBaseReport', {
				requestId: 3,
				reportBase: 'ConfigurationInventory',
			}),
		).toEqual({ status: 'EmptyResultSet' });
		harness.simulator.state.variables = { LooseVariable: 'x' };
		expect(
			await call(harness, 'report-6', 'GetBaseReport', {
				requestId: 4,
				reportBase: 'FullInventory',
			}),
		).toEqual({ status: 'EmptyResultSet' });
		expect(
			harness
				.calls('NotifyReport')
				.filter((frame) => (frame[3] as Record<string, unknown>)['requestId'] === 4),
		).toHaveLength(0);
	});

	it('builds reports before boot and queues NotifyReport', async () => {
		const harness = createHarness201({
			bootStatus: 'Pending',
			boot: { auto: true, required: true, retryOnPending: false },
		});
		await harness.ready();
		expect(
			await call(harness, 'report-ready', 'GetBaseReport', {
				requestId: 8,
				reportBase: 'FullInventory',
			}),
		).toEqual({ status: 'Accepted' });
		expect(harness.calls('NotifyReport')).toHaveLength(0);
		expect(harness.simulator.getQueue().some((entry) => entry.action === 'NotifyReport')).toBe(
			true,
		);
	});

	it('reports transaction status and queued transaction events', async () => {
		const harness = createHarness201();
		await harness.ready();
		expect(await call(harness, 'status-1', 'GetTransactionStatus', {})).toEqual({
			messagesInQueue: false,
		});
		const started = await harness.simulator.startChargingSession(1, 'A');
		expect(await call(harness, 'status-2', 'GetTransactionStatus', {})).toEqual({
			messagesInQueue: false,
		});
		expect(
			await call(harness, 'status-3', 'GetTransactionStatus', {
				transactionId: started.transactionId,
			}),
		).toEqual({ messagesInQueue: false, ongoingIndicator: true });
		expect(
			await call(harness, 'status-4', 'GetTransactionStatus', {
				transactionId: 'other',
			}),
		).toEqual({ messagesInQueue: false, ongoingIndicator: false });

		const offline = createHarness201({
			bootStatus: 'Pending',
			boot: { auto: true, required: true, retryOnPending: false },
		});
		await offline.ready();
		await offline.simulator.sendOrQueue('TransactionEvent', {
			eventType: 'Updated',
			timestamp: '2026-01-01T00:00:00Z',
			triggerReason: 'MeterValuePeriodic',
			seqNo: 0,
			transactionInfo: { transactionId: 'T-9' },
			offline: true,
		});
		expect(
			await call(offline, 'status-5', 'GetTransactionStatus', {
				transactionId: 'T-9',
			}),
		).toEqual({ messagesInQueue: true, ongoingIndicator: false });
		expect(await call(offline, 'status-6', 'GetTransactionStatus', {})).toEqual({
			messagesInQueue: true,
		});
		expect(
			await call(offline, 'status-7', 'GetTransactionStatus', {
				transactionId: 'other',
			}),
		).toEqual({ messagesInQueue: false, ongoingIndicator: false });
	});

	it('honors the inbound reject mode for status-shaped actions', async () => {
		const harness = createHarness201();
		await harness.ready();
		harness.simulator.setInboundResponseMode('reject');
		expect(
			await call(harness, 'reject-1', 'RequestStartTransaction', {
				remoteStartId: 1,
				idToken: { idToken: 'A', type: 'ISO14443' },
			}),
		).toEqual({ status: 'Rejected' });
		expect(
			await call(harness, 'reject-2', 'RequestStopTransaction', { transactionId: 'x' }),
		).toEqual({ status: 'Rejected' });
		expect(await call(harness, 'reject-3', 'Reset', { type: 'Immediate' })).toEqual({
			status: 'Rejected',
		});
		expect(
			await call(harness, 'reject-4', 'TriggerMessage', {
				requestedMessage: 'Heartbeat',
			}),
		).toEqual({ status: 'Rejected' });
		expect(
			await call(harness, 'reject-5', 'ChangeAvailability', {
				operationalStatus: 'Inoperative',
			}),
		).toEqual({ status: 'Rejected' });
		expect(
			await call(harness, 'reject-6', 'UnlockConnector', { evseId: 1, connectorId: 1 }),
		).toEqual({ status: 'UnlockFailed' });
		expect(await call(harness, 'reject-7', 'ClearCache', {})).toEqual({
			status: 'Rejected',
		});
		expect(await call(harness, 'reject-8', 'DataTransfer', { vendorId: 'x' })).toEqual({
			status: 'Rejected',
		});
		expect(
			await call(harness, 'reject-9', 'GetBaseReport', {
				requestId: 1,
				reportBase: 'FullInventory',
			}),
		).toEqual({ status: 'Rejected' });
		harness.simulator.setInboundResponseMode('auto');
		expect(
			await call(harness, 'reject-10', 'GetVariables', {
				getVariableData: [
					{ component: { name: 'OCPPCommCtrlr' }, variable: { name: 'HeartbeatInterval' } },
				],
			}),
		).toMatchObject({ getVariableResult: [{ attributeStatus: 'Accepted' }] });
	});
});
