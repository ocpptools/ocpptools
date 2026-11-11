// SPDX-License-Identifier: Apache-2.0
// SPDX-FileCopyrightText: 2026 Rodolfo Carrillo

import { Simulator16 } from '../../src/1.6.js';
import { FakeClock, flushMicrotasks } from './fake-clock.js';
import { FakeTransportFactory, type FakeTransport } from './fake-transport.js';

export type Frame = unknown[];

export type Frame16Responder = (frame: Frame, transport: FakeTransport) => boolean;

export interface Harness16Options {
	readonly bootStatus?: string;
	readonly bootIntervalSeconds?: number;
	readonly authorizeStatus?: string;
	readonly responder?: Frame16Responder;
}

export interface Harness16 {
	readonly clock: FakeClock;
	readonly factory: FakeTransportFactory;
	readonly simulator: Simulator16;
	readonly transport: FakeTransport;
	readonly sent: () => Frame[];
	readonly calls: (action?: string) => Frame[];
	readonly reply: (messageId: string) => Frame | undefined;
	readonly incoming: (messageId: string, action: string, payload: unknown) => void;
	readonly ready: (count?: number) => Promise<void>;
}

export function installResponder16(transport: FakeTransport, options: Harness16Options = {}): void {
	const original = transport.send.bind(transport);
	transport.send = (text: string): void => {
		original(text);
		const frame = JSON.parse(text) as Frame;
		if (frame[0] !== 2) return;
		if (options.responder?.(frame, transport) === true) return;
		const [, messageId, action] = frame as [number, string, string];
		const responses: Record<string, Record<string, unknown>> = {
			BootNotification: {
				status: options.bootStatus ?? 'Accepted',
				currentTime: '2026-01-01T00:00:00Z',
				interval: options.bootIntervalSeconds ?? 60,
			},
			Authorize: { idTagInfo: { status: options.authorizeStatus ?? 'Accepted' } },
			StartTransaction: { transactionId: 1, idTagInfo: { status: 'Accepted' } },
			StopTransaction: { idTagInfo: { status: 'Accepted' } },
			Heartbeat: { currentTime: '2026-01-01T00:00:00Z' },
			DataTransfer: { status: 'Accepted' },
		};
		transport.receive(JSON.stringify([3, messageId, responses[action] ?? {}]));
	};
}

export function createHarness16(options: Harness16Options = {}): Harness16 {
	const clock = new FakeClock();
	const factory = new FakeTransportFactory();
	let sequence = 0;
	const simulator = new Simulator16({
		url: 'ws://localhost/CP16',
		transport: factory.factory,
		clock,
		messageIds: () => `id-${++sequence}`,
		station: {
			id: 'CP16',
			vendor: 'Acme',
			model: 'AC-7',
			firmwareVersion: '1.0.0',
			connectorCount: 2,
			defaultIdTag: 'AABBCCDD',
		},
	});
	simulator.connect();
	const transport = factory.transports[0]!;
	installResponder16(transport, options);
	transport.open();
	const sent = (): Frame[] => transport.sent.map((text) => JSON.parse(text) as Frame);
	const calls = (action?: string): Frame[] =>
		sent().filter((frame) => frame[0] === 2 && (action === undefined || frame[2] === action));
	return {
		clock,
		factory,
		simulator,
		transport,
		sent,
		calls,
		reply: (messageId) =>
			sent().find((frame) => (frame[0] === 3 || frame[0] === 4) && frame[1] === messageId),
		incoming: (messageId, action, payload) => {
			transport.receive(JSON.stringify([2, messageId, action, payload]));
		},
		ready: (count = 80) => flushMicrotasks(count),
	};
}

export function framePayload16(frame: Frame | undefined): Record<string, unknown> {
	if (frame === undefined) return {};
	return (frame[2] as Record<string, unknown> | undefined) ?? {};
}
