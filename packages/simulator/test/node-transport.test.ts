// SPDX-License-Identifier: Apache-2.0
// SPDX-FileCopyrightText: 2026 Rodolfo Carrillo

import { afterEach, describe, expect, it, vi } from 'vitest';
import { WebSocket as WsWebSocket, WebSocketServer, type WebSocket as ServerWebSocket } from 'ws';

import type { TransportCloseEvent } from '@ocpptools/core';
import {
	createNodeWebSocketTransportFactory,
	type NodeWebSocketConstructor,
} from '@ocpptools/simulator/node';

import { Connection } from '../src/connection.js';
import { Scheduler } from '../src/clock.js';
import { EventEmitter } from '../src/events.js';
import { FakeClock } from './helpers/fake-clock.js';

type Listener = (event: unknown) => void;

interface TestServer {
	readonly server: WebSocketServer;
	readonly url: string;
	readonly sockets: Set<ServerWebSocket>;
}

async function startServer(onConnection?: (socket: ServerWebSocket) => void): Promise<TestServer> {
	const sockets = new Set<ServerWebSocket>();
	const server = new WebSocketServer({
		host: '127.0.0.1',
		port: 0,
		handleProtocols: (protocols) => (protocols.has('ocpp1.6') ? 'ocpp1.6' : false),
	});
	await new Promise<void>((resolve, reject) => {
		server.once('listening', resolve);
		server.once('error', reject);
	});
	server.on('connection', (socket) => {
		sockets.add(socket);
		socket.on('close', () => {
			sockets.delete(socket);
		});
		onConnection?.(socket);
	});
	const address = server.address();
	if (address === null || typeof address === 'string') {
		throw new Error('The test server did not expose a TCP address');
	}
	return { server, sockets, url: `ws://127.0.0.1:${String(address.port)}/CP001` };
}

async function stopServer(testServer: TestServer): Promise<void> {
	for (const socket of testServer.sockets) socket.terminate();
	await new Promise<void>((resolve, reject) => {
		testServer.server.close((error) => (error === undefined ? resolve() : reject(error)));
	});
}

function withTimeout<T>(promise: Promise<T>, label: string, timeoutMs = 5000): Promise<T> {
	return new Promise<T>((resolve, reject) => {
		const timer = setTimeout(() => {
			reject(new Error(`Timed out waiting for ${label}`));
		}, timeoutMs);
		promise.then(
			(value) => {
				clearTimeout(timer);
				resolve(value);
			},
			(error: unknown) => {
				clearTimeout(timer);
				reject(error instanceof Error ? error : new Error(String(error)));
			},
		);
	});
}

async function waitFor(predicate: () => boolean, label: string, timeoutMs = 5000): Promise<void> {
	const deadline = Date.now() + timeoutMs;
	while (!predicate()) {
		if (Date.now() > deadline) throw new Error(`Timed out waiting for ${label}`);
		await new Promise((resolve) => setTimeout(resolve, 10));
	}
}

class FakeWebSocket {
	static readonly instances: FakeWebSocket[] = [];
	readyState = 0;
	readonly sent: string[] = [];
	readonly closeCalls: Array<{ code?: number; reason?: string }> = [];
	readonly listeners = new Map<string, Set<Listener>>();

	constructor(
		readonly url: string,
		readonly protocols?: string | string[],
	) {
		FakeWebSocket.instances.push(this);
	}

	addEventListener(type: string, listener: Listener): void {
		const set = this.listeners.get(type) ?? new Set<Listener>();
		set.add(listener);
		this.listeners.set(type, set);
	}

	send(data: string): void {
		if (this.readyState !== 1) throw new Error('not open');
		this.sent.push(data);
	}

	close(code = 1000, reason = ''): void {
		this.closeCalls.push({ code, reason });
		this.readyState = 3;
		this.emit('close', { code, reason, wasClean: code === 1000 });
	}

	emit(type: string, event: unknown): void {
		for (const listener of this.listeners.get(type) ?? []) listener(event);
	}

	open(): void {
		this.readyState = 1;
		this.emit('open', {});
	}
}

function createFakeTransport() {
	FakeWebSocket.instances.length = 0;
	const factory = createNodeWebSocketTransportFactory(
		FakeWebSocket as unknown as NodeWebSocketConstructor,
	);
	const transport = factory({
		url: 'wss://example.com/CP001',
		subprotocol: 'ocpp1.6',
	});
	return { transport, socket: FakeWebSocket.instances[0]! };
}

afterEach(() => {
	vi.unstubAllGlobals();
});

describe('node WebSocket transport', () => {
	it('connects with the built-in WebSocket, sends text, and closes cleanly', async () => {
		const protocols: string[] = [];
		const received: string[] = [];
		const testServer = await startServer((socket) => {
			protocols.push(socket.protocol);
			socket.on('message', (data) => {
				const text = Array.isArray(data)
					? Buffer.concat(data).toString('utf8')
					: Buffer.isBuffer(data)
						? data.toString('utf8')
						: Buffer.from(new Uint8Array(data)).toString('utf8');
				received.push(text);
				socket.send('[3,"1",{}]');
			});
		});
		try {
			const transport = createNodeWebSocketTransportFactory()({
				url: testServer.url,
				subprotocol: 'ocpp1.6',
			});
			await withTimeout(
				new Promise<void>((resolve, reject) => {
					transport.onOpen(resolve);
					transport.onError(reject);
				}),
				'the transport to open',
			);
			expect(transport.state).toBe('open');
			expect(protocols).toEqual(['ocpp1.6']);
			transport.send('[2,"1","Heartbeat",{}]');
			const message = await withTimeout(
				new Promise<string>((resolve) => transport.onMessage(resolve)),
				'the echo message',
			);
			expect(message).toBe('[3,"1",{}]');
			expect(received).toEqual(['[2,"1","Heartbeat",{}]']);

			const closed = withTimeout(
				new Promise<TransportCloseEvent>((resolve) => transport.onClose(resolve)),
				'the close event',
			);
			transport.close(1000, 'done');
			await expect(closed).resolves.toMatchObject({ code: 1000, wasClean: true });
			expect(transport.state).toBe('closed');
			expect(() => transport.send('x')).toThrow('not open');
			transport.close();
		} finally {
			await stopServer(testServer);
		}
	});

	it('reports an abnormal termination as 1006 and not clean', async () => {
		const testServer = await startServer((socket) => {
			socket.terminate();
		});
		try {
			const constructor: NodeWebSocketConstructor = WsWebSocket;
			const transport = createNodeWebSocketTransportFactory(constructor)({
				url: testServer.url,
				subprotocol: 'ocpp1.6',
			});
			const closed = await withTimeout(
				new Promise<TransportCloseEvent>((resolve) => transport.onClose(resolve)),
				'the abnormal close event',
			);
			expect(closed.code).toBe(1006);
			expect(closed.wasClean).toBe(false);
			expect(transport.state).toBe('closed');
		} finally {
			await stopServer(testServer);
		}
	});

	it('synthesizes one close when Node 22 emits an error before open', () => {
		const { transport, socket } = createFakeTransport();
		const closes: TransportCloseEvent[] = [];
		transport.onClose((event) => closes.push(event));
		socket.emit('error', { error: new Error('refused') });
		expect(closes).toEqual([{ code: 1006, reason: '', wasClean: false }]);
		expect(transport.state).toBe('closed');
		socket.emit('close', { code: 1006, reason: '', wasClean: false });
		expect(closes).toHaveLength(1);
	});

	it('closes when the handshake is rejected before open', async () => {
		const server = new WebSocketServer({
			host: '127.0.0.1',
			port: 0,
			verifyClient: () => false,
		});
		await new Promise<void>((resolve, reject) => {
			server.once('listening', resolve);
			server.once('error', reject);
		});
		const address = server.address();
		if (address === null || typeof address === 'string') throw new Error('no address');
		try {
			const transport = createNodeWebSocketTransportFactory()({
				url: `ws://127.0.0.1:${String(address.port)}/CP001`,
				subprotocol: 'ocpp1.6',
			});
			const closed = await withTimeout(
				new Promise<TransportCloseEvent>((resolve) => transport.onClose(resolve)),
				'the rejected handshake close',
			);
			expect(closed.code).toBe(1006);
			expect(closed.wasClean).toBe(false);
			expect(transport.state).toBe('closed');
		} finally {
			await new Promise<void>((resolve) => server.close(() => resolve()));
		}
	});

	it('handles text, ArrayBuffer, Buffer, Buffer[], and Uint8Array messages', () => {
		const { transport, socket } = createFakeTransport();
		expect(socket.url).toBe('wss://example.com/CP001');
		expect(socket.protocols).toBe('ocpp1.6');
		expect(transport.state).toBe('connecting');
		expect(() => transport.send('x')).toThrow('not open');

		const messages: string[] = [];
		const errors: unknown[] = [];
		const closes: TransportCloseEvent[] = [];
		transport.onMessage((message) => messages.push(message));
		transport.onError((error) => errors.push(error));
		transport.onClose((event) => closes.push(event));

		socket.open();
		expect(transport.state).toBe('open');
		transport.send('[2,"1","Heartbeat",{}]');
		expect(socket.sent).toEqual(['[2,"1","Heartbeat",{}]']);

		socket.emit('message', { data: 'one' });
		socket.emit('message', { data: new TextEncoder().encode('two').buffer });
		socket.emit('message', { data: Buffer.from('three') });
		socket.emit('message', { data: [Buffer.from('fo'), Buffer.from('ur')] });
		socket.emit('message', { data: new TextEncoder().encode('five') });
		socket.emit('message', { data: 42 });
		socket.emit('message', { data: [Buffer.from('six'), 42] });
		socket.emit('message', { data: [] });
		expect(messages).toEqual(['one', 'two', 'three', 'four', 'five']);

		const error = { error: new Error('boom'), message: 'boom' };
		socket.emit('error', error);
		expect(errors).toEqual([error]);

		transport.close(1001, 'going away');
		transport.close();
		expect(socket.closeCalls).toEqual([{ code: 1001, reason: 'going away' }]);
		expect(closes).toEqual([{ code: 1001, reason: 'going away', wasClean: false }]);
		expect(transport.state).toBe('closed');
	});

	it('unsubscribes listeners', () => {
		const { transport, socket } = createFakeTransport();
		let messages = 0;
		const unsubscribe = transport.onMessage(() => {
			messages += 1;
		});
		socket.open();
		socket.emit('message', { data: 'x' });
		unsubscribe();
		socket.emit('message', { data: 'y' });
		expect(messages).toBe(1);
	});

	it('falls back to 1006 and honors an explicit wasClean value', () => {
		const first = createFakeTransport();
		first.socket.open();
		const firstCloses: TransportCloseEvent[] = [];
		first.transport.onClose((event) => firstCloses.push(event));
		first.socket.emit('close', {});
		expect(firstCloses).toEqual([{ code: 1006, reason: '', wasClean: false }]);

		const second = createFakeTransport();
		second.socket.open();
		const secondCloses: TransportCloseEvent[] = [];
		second.transport.onClose((event) => secondCloses.push(event));
		second.socket.emit('close', { code: 1006, reason: 'lost', wasClean: true });
		expect(secondCloses).toEqual([{ code: 1006, reason: 'lost', wasClean: true }]);
	});

	it('rejects a missing WebSocket implementation', () => {
		vi.stubGlobal('WebSocket', undefined);
		const factory = createNodeWebSocketTransportFactory();
		expect(() => factory({ url: 'wss://example.com/CP001', subprotocol: 'ocpp1.6' })).toThrow(
			'WebSocket is not available',
		);
	});
});

describe('node WebSocket reconnection', () => {
	it('reconnects with a new transport after an abnormal close', async () => {
		let connections = 0;
		const testServer = await startServer((socket) => {
			connections += 1;
			if (connections === 1) socket.terminate();
		});
		const clock = new FakeClock();
		const scheduler = new Scheduler(clock);
		const events = new EventEmitter(() => clock.now());
		const connection = new Connection({
			url: testServer.url,
			subprotocol: 'ocpp1.6',
			transportFactory: createNodeWebSocketTransportFactory(),
			scheduler,
			events,
			reconnect: { baseDelayMs: 1000, maxAttempts: 3 },
			connectTimeoutMs: 5000,
		});
		try {
			connection.connect();
			await waitFor(
				() => connection.getState().state === 'reconnecting',
				'the first connection to drop',
			);
			expect(connections).toBe(1);
			clock.advance(1000);
			await waitFor(() => connections === 2, 'the second connection');
			await waitFor(() => connection.isOpen(), 'the second transport to open');
			connection.dispose();
			expect(connection.getState().state).toBe('disconnected');
		} finally {
			connection.dispose();
			await stopServer(testServer);
		}
	});
});
