// SPDX-License-Identifier: Apache-2.0
// SPDX-FileCopyrightText: 2026 Rodolfo Carrillo

import type {
	Transport,
	TransportCloseEvent,
	TransportConnectOptions,
	TransportFactory,
	TransportState,
	Unsubscribe,
} from '@ocpptools/core';

type Listener<T> = (value: T) => void;

class WebSocketTransport implements Transport {
	state: TransportState = 'connecting';
	private readonly socket: WebSocket;
	private readonly openListeners = new Set<Listener<void>>();
	private readonly messageListeners = new Set<Listener<string>>();
	private readonly errorListeners = new Set<Listener<unknown>>();
	private readonly closeListeners = new Set<Listener<TransportCloseEvent>>();

	constructor(options: TransportConnectOptions, WebSocketImpl: typeof WebSocket) {
		this.socket = new WebSocketImpl(options.url, options.subprotocol);
		this.socket.addEventListener('open', () => {
			if (this.state !== 'connecting') return;
			this.state = 'open';
			for (const listener of this.openListeners) listener();
		});
		this.socket.addEventListener('message', (event) => {
			void toText(event.data).then((text) => {
				if (text === undefined) return;
				for (const listener of this.messageListeners) listener(text);
			});
		});
		this.socket.addEventListener('error', (event) => {
			for (const listener of this.errorListeners) listener(event);
		});
		this.socket.addEventListener('close', (event) => {
			if (this.state === 'closed') return;
			this.state = 'closed';
			const closeEvent: TransportCloseEvent = {
				code: event.code,
				reason: event.reason,
				wasClean: event.wasClean,
			};
			for (const listener of this.closeListeners) listener(closeEvent);
		});
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

/** Creates a transport factory backed by the browser `WebSocket` (or a test double). */
export function createWebSocketTransportFactory(
	WebSocketImpl?: typeof WebSocket,
): TransportFactory {
	return (options) => {
		const Constructor = WebSocketImpl ?? globalThis.WebSocket;
		if (typeof Constructor !== 'function') {
			throw new Error('WebSocket is not available in this environment');
		}
		return new WebSocketTransport(options, Constructor);
	};
}

function subscribe<T>(listeners: Set<T>, listener: T): Unsubscribe {
	listeners.add(listener);
	return () => {
		listeners.delete(listener);
	};
}

async function toText(data: unknown): Promise<string | undefined> {
	if (typeof data === 'string') return data;
	if (data instanceof ArrayBuffer) return new TextDecoder().decode(data);
	if (typeof Blob !== 'undefined' && data instanceof Blob) return data.text();
	return undefined;
}
