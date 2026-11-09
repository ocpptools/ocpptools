// SPDX-License-Identifier: Apache-2.0
// SPDX-FileCopyrightText: 2026 Rodolfo Carrillo

import { Simulator201, type SecurityOptions201 } from '../../src/2.0.1.js';
import { FakeClock, flushMicrotasks } from './fake-clock.js';
import { FakeTransportFactory, type FakeTransport } from './fake-transport.js';

export type Frame = unknown[];

export interface ResponderOptions {
	readonly bootStatus?: string | ((count: number) => string);
	readonly bootIntervalSeconds?: number;
	readonly authorizeStatus?: string | ((count: number) => string);
	readonly authorizeGroup?: string;
	readonly failTransactionEvent?: boolean;
	readonly responses?: Record<string, Record<string, unknown>>;
}

export interface Harness201Options extends ResponderOptions {
	readonly evseCount?: number;
	readonly power?: number;
	readonly boot?: { auto?: boolean; required?: boolean; retryOnPending?: boolean };
	readonly security?: SecurityOptions201;
}

export interface Harness201 {
	readonly clock: FakeClock;
	readonly factory: FakeTransportFactory;
	readonly simulator: Simulator201;
	readonly transport: FakeTransport;
	readonly sent: () => Frame[];
	readonly calls: (action?: string) => Frame[];
	readonly reply: (messageId: string) => Frame | undefined;
	readonly incoming: (messageId: string, action: string, payload: unknown) => void;
	readonly ready: () => Promise<void>;
}

export function installResponder(transport: FakeTransport, options: ResponderOptions = {}): void {
	const original = transport.send.bind(transport);
	let boots = 0;
	let authorizes = 0;
	transport.send = (text: string): void => {
		original(text);
		const frame = JSON.parse(text) as Frame;
		if (frame[0] !== 2) return;
		const [, messageId, action] = frame as [number, string, string];
		if (action === 'TransactionEvent' && options.failTransactionEvent === true) {
			transport.receive(JSON.stringify([4, messageId, 'InternalError', 'failed', {}]));
			return;
		}
		const bootStatus =
			typeof options.bootStatus === 'function'
				? options.bootStatus(++boots)
				: (options.bootStatus ?? 'Accepted');
		const authorizeStatus =
			typeof options.authorizeStatus === 'function'
				? options.authorizeStatus(++authorizes)
				: (options.authorizeStatus ?? 'Accepted');
		const responses: Record<string, Record<string, unknown>> = {
			BootNotification: {
				status: bootStatus,
				currentTime: '2026-01-01T00:00:00Z',
				interval: options.bootIntervalSeconds ?? 60,
			},
			Authorize: {
				idTokenInfo: {
					status: authorizeStatus,
					...(options.authorizeGroup === undefined
						? {}
						: {
								groupIdToken: {
									idToken: options.authorizeGroup,
									type: 'Central',
								},
							}),
				},
			},
			StatusNotification: {},
			TransactionEvent: {},
			Heartbeat: { currentTime: '2026-01-01T00:00:00Z' },
			MeterValues: {},
			NotifyReport: {},
			SignCertificate: { status: 'Accepted' },
			Get15118EVCertificate: { status: 'Accepted', exiResponse: 'exi-response' },
			GetCertificateStatus: { status: 'Accepted', ocspResult: 'ocsp-response' },
			...options.responses,
		};
		transport.receive(JSON.stringify([3, messageId, responses[action] ?? {}]));
	};
}

export function createHarness201(options: Harness201Options = {}): Harness201 {
	const clock = new FakeClock();
	const factory = new FakeTransportFactory();
	let sequence = 0;
	const simulator = new Simulator201({
		url: 'ws://localhost/CP201',
		transport: factory.factory,
		clock,
		messageIds: () => `id-${++sequence}`,
		station: {
			id: 'CP201',
			vendorName: 'Acme',
			model: 'AC-22',
			firmwareVersion: '2.0.0',
			evseCount: options.evseCount ?? 2,
			defaultIdToken: 'AABBCCDD',
			idTokenType: 'ISO14443',
			defaultChargingPowerKw: options.power ?? 7.4,
		},
		...(options.boot === undefined ? {} : { boot: options.boot }),
		...(options.security === undefined ? {} : { security: options.security }),
	});
	simulator.connect();
	const transport = factory.transports[0]!;
	installResponder(transport, options);
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
		ready: () => flushMicrotasks(80),
	};
}

export function framePayload(frame: Frame | undefined): Record<string, unknown> {
	if (frame === undefined) return {};
	return (frame[2] as Record<string, unknown> | undefined) ?? {};
}
