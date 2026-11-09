// SPDX-License-Identifier: Apache-2.0
// SPDX-FileCopyrightText: 2026 Rodolfo Carrillo

import { TextDecoder } from 'node:util';

import type {
	Transport,
	TransportCloseEvent,
	TransportConnectOptions,
	TransportFactory,
	TransportState,
	Unsubscribe,
} from '@ocpptools/core';

type Listener<T> = (value: T) => void;

/** The subset of an `open` event this adapter reads. */
export interface NodeWebSocketOpenEvent {
	readonly type?: string;
}

/** The subset of a `message` event this adapter reads. */
export interface NodeWebSocketMessageEvent {
	readonly data: unknown;
}

/** The subset of an `error` event this adapter forwards. */
export interface NodeWebSocketErrorEvent {
	readonly error?: unknown;
	readonly message?: string;
}

/** The subset of a `close` event this adapter reads. */
export interface NodeWebSocketCloseEvent {
	readonly code?: number;
	readonly reason?: string;
	readonly wasClean?: boolean;
}

/**
 * The structural WebSocket surface the Node adapter needs. It is intentionally
 * smaller than the global `WebSocket` type so a caller can inject `ws` or a
 * test double without leaking either implementation into the declaration.
 */
export interface NodeWebSocketLike {
	readonly readyState: number;
	binaryType?: string;
	addEventListener(type: 'open', listener: Listener<NodeWebSocketOpenEvent>): void;
	addEventListener(type: 'message', listener: Listener<NodeWebSocketMessageEvent>): void;
	addEventListener(type: 'error', listener: Listener<NodeWebSocketErrorEvent>): void;
	addEventListener(type: 'close', listener: Listener<NodeWebSocketCloseEvent>): void;
	send(data: string): void;
	close(code?: number, reason?: string): void;
}

/** Constructs a {@link NodeWebSocketLike} from a URL and an optional subprotocol. */
export type NodeWebSocketConstructor = new (
	url: string,
	protocols?: string | string[],
) => NodeWebSocketLike;

class NodeWebSocketTransport implements Transport {
	state: TransportState = 'connecting';
	private readonly socket: NodeWebSocketLike;
	private readonly openListeners = new Set<Listener<void>>();
	private readonly messageListeners = new Set<Listener<string>>();
	private readonly errorListeners = new Set<Listener<unknown>>();
	private readonly closeListeners = new Set<Listener<TransportCloseEvent>>();

	constructor(options: TransportConnectOptions, WebSocketImpl: NodeWebSocketConstructor) {
		this.socket = new WebSocketImpl(options.url, options.subprotocol);
		if (this.socket.binaryType !== undefined) {
			this.socket.binaryType = 'arraybuffer';
		}
		this.socket.addEventListener('open', () => {
			if (this.state !== 'connecting') return;
			this.state = 'open';
			for (const listener of this.openListeners) listener();
		});
		this.socket.addEventListener('message', (event) => {
			const text = toText(event.data);
			if (text === undefined) return;
			for (const listener of this.messageListeners) listener(text);
		});
		this.socket.addEventListener('error', (event) => {
			for (const listener of this.errorListeners) listener(event);
			// Node 22 can emit error without close for refused/DNS/TLS failures.
			if (this.state === 'connecting' || this.state === 'closing') {
				this.emitClose(1006, '', false);
			}
		});
		this.socket.addEventListener('close', (event) => {
			const code = event.code ?? 1006;
			this.emitClose(code, event.reason ?? '', event.wasClean ?? code === 1000);
		});
	}

	private emitClose(code: number, reason: string, wasClean: boolean): void {
		if (this.state === 'closed') return;
		this.state = 'closed';
		const closeEvent: TransportCloseEvent = { code, reason, wasClean };
		for (const listener of this.closeListeners) listener(closeEvent);
	}

	send(data: string): void {
		if (this.state !== 'open') {
			throw new Error('The WebSocket is not open');
		}
		this.socket.send(data);
	}

	close(code = 1000, reason = ''): void {
		if (this.state === 'closing' || this.state === 'closed') return;
		this.state = 'closing';
		this.socket.close(code, reason);
	}

	onOpen(listener: () => void): Unsubscribe {
		return subscribe(this.openListeners, listener);
	}

	onMessage(listener: (data: string) => void): Unsubscribe {
		return subscribe(this.messageListeners, listener);
	}

	onError(listener: (error: unknown) => void): Unsubscribe {
		return subscribe(this.errorListeners, listener);
	}

	onClose(listener: (event: TransportCloseEvent) => void): Unsubscribe {
		return subscribe(this.closeListeners, listener);
	}
}

/** Creates a transport factory backed by the Node `WebSocket` (or a test double). */
export function createNodeWebSocketTransportFactory(
	WebSocketImpl: NodeWebSocketConstructor = globalThis.WebSocket,
): TransportFactory {
	return (options) => {
		const Constructor =
			WebSocketImpl ?? (globalThis as { WebSocket?: NodeWebSocketConstructor }).WebSocket;
		if (typeof Constructor !== 'function') {
			throw new Error('WebSocket is not available in this environment');
		}
		return new NodeWebSocketTransport(options, Constructor);
	};
}

function subscribe<T>(listeners: Set<T>, listener: T): Unsubscribe {
	listeners.add(listener);
	return () => {
		listeners.delete(listener);
	};
}

function toText(data: unknown): string | undefined {
	if (typeof data === 'string') return data;
	if (data instanceof ArrayBuffer) return new TextDecoder().decode(data);
	if (ArrayBuffer.isView(data)) {
		return new TextDecoder().decode(new Uint8Array(data.buffer, data.byteOffset, data.byteLength));
	}
	if (Array.isArray(data)) {
		const chunks = data.filter((chunk): chunk is ArrayBufferView => ArrayBuffer.isView(chunk));
		if (chunks.length !== data.length || chunks.length === 0) return undefined;
		const length = chunks.reduce((total, chunk) => total + chunk.byteLength, 0);
		const bytes = new Uint8Array(length);
		let offset = 0;
		for (const chunk of chunks) {
			bytes.set(new Uint8Array(chunk.buffer, chunk.byteOffset, chunk.byteLength), offset);
			offset += chunk.byteLength;
		}
		return new TextDecoder().decode(bytes);
	}
	return undefined;
}
