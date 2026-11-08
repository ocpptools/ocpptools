// SPDX-License-Identifier: Apache-2.0
// SPDX-FileCopyrightText: 2026 Rodolfo Carrillo

import { describe, expect, it } from 'vitest';

import {
	browserClock,
	createWebSocketTransportFactory,
	createWebStorage,
} from '@ocpptools/simulator/browser';

type Listener = (event: unknown) => void;

class FakeWebSocket {
	static readonly instances: FakeWebSocket[] = [];
	readyState = 0;
	readonly sent: string[] = [];
	readonly listeners = new Map<string, Set<Listener>>();

	constructor(
		readonly url: string,
		readonly protocol: string,
	) {
		FakeWebSocket.instances.push(this);
	}

	addEventListener(type: string, listener: Listener): void {
		const set = this.listeners.get(type) ?? new Set<Listener>();
		set.add(listener);
		this.listeners.set(type, set);
	}

	removeEventListener(type: string, listener: Listener): void {
		this.listeners.get(type)?.delete(listener);
	}

	send(data: string): void {
		if (this.readyState !== 1) throw new Error('not open');
		this.sent.push(data);
	}

	close(code = 1000, reason = ''): void {
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

function createTransport() {
	FakeWebSocket.instances.length = 0;
	const factory = createWebSocketTransportFactory(FakeWebSocket as unknown as typeof WebSocket);
	const transport = factory({
		url: 'wss://example.com/CP001',
		subprotocol: 'ocpp2.0.1',
	});
	return { factory, transport, socket: FakeWebSocket.instances[0]! };
}

describe('browser adapter', () => {
	it('adapts a WebSocket to the Transport interface', async () => {
		const { transport, socket } = createTransport();
		expect(socket.url).toBe('wss://example.com/CP001');
		expect(socket.protocol).toBe('ocpp2.0.1');
		expect(transport.state).toBe('connecting');
		expect(() => transport.send('x')).toThrow('not open');
		const opened: string[] = [];
		const messages: string[] = [];
		const close: unknown[] = [];
		let errors = 0;
		transport.onOpen(() => opened.push('open'));
		transport.onMessage((message) => messages.push(message));
		transport.onClose((event) => close.push(event));
		transport.onError(() => {
			errors += 1;
		});
		socket.open();
		expect(transport.state).toBe('open');
		expect(opened).toEqual(['open']);
		transport.send('[2,"1","Heartbeat",{}]');
		expect(socket.sent).toEqual(['[2,"1","Heartbeat",{}]']);
		socket.emit('message', { data: '[2,"2","Heartbeat",{}]' });
		socket.emit('message', { data: new TextEncoder().encode('[2,"3","Heartbeat",{}]').buffer });
		socket.emit('message', { data: new Blob(['[2,"4","Heartbeat",{}]']) });
		socket.emit('error', new Error('boom'));
		await new Promise((resolve) => setTimeout(resolve, 0));
		expect(messages).toEqual([
			'[2,"2","Heartbeat",{}]',
			'[2,"3","Heartbeat",{}]',
			'[2,"4","Heartbeat",{}]',
		]);
		expect(errors).toBe(1);
		transport.close(1000, 'done');
		expect(socket.readyState).toBe(3);
		expect(transport.state).toBe('closed');
		expect(close).toEqual([{ code: 1000, reason: 'done', wasClean: true }]);
		transport.close();
	});

	it('unsubscribes listeners', async () => {
		const { transport, socket } = createTransport();
		let messages = 0;
		const unsubscribe = transport.onMessage(() => {
			messages += 1;
		});
		socket.open();
		socket.emit('message', { data: 'x' });
		await Promise.resolve();
		unsubscribe();
		socket.emit('message', { data: 'y' });
		await Promise.resolve();
		expect(messages).toBe(1);
	});

	it('exposes a browser clock and Web Storage adapter', async () => {
		expect(typeof browserClock.now()).toBe('number');
		const fired = new Promise<boolean>((resolve) => {
			browserClock.setTimeout(() => resolve(true), 0);
		});
		await expect(fired).resolves.toBe(true);
		const values = new Map<string, string>();
		const storage = createWebStorage({
			getItem: (key) => values.get(key) ?? null,
			setItem: (key, value) => {
				values.set(key, value);
			},
			removeItem: (key) => {
				values.delete(key);
			},
		});
		await storage.set('key', 'value');
		await expect(storage.get('key')).resolves.toBe('value');
		await storage.delete('key');
		await expect(storage.get('key')).resolves.toBeUndefined();
	});
});
