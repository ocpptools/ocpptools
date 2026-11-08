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

export class FakeTransport implements Transport {
	state: TransportState = 'connecting';
	readonly sent: string[] = [];
	readonly closeCalls: Array<{ code?: number; reason?: string }> = [];
	private readonly openListeners = new Set<() => void>();
	private readonly messageListeners = new Set<(data: string) => void>();
	private readonly errorListeners = new Set<(error: unknown) => void>();
	private readonly closeListeners = new Set<(event: TransportCloseEvent) => void>();

	send(data: string): void {
		if (this.state !== 'open') {
			throw new Error('Transport is not open');
		}
		this.sent.push(data);
	}

	close(code = 1000, reason = ''): void {
		this.closeCalls.push({ code, reason });
		if (this.state === 'closed') {
			return;
		}
		this.state = 'closed';
		for (const listener of this.closeListeners) {
			listener({ code, reason, wasClean: code === 1000 });
		}
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

	open(): void {
		if (this.state !== 'connecting') {
			return;
		}
		this.state = 'open';
		for (const listener of this.openListeners) {
			listener();
		}
	}

	receive(data: string): void {
		for (const listener of this.messageListeners) {
			listener(data);
		}
	}

	fail(error: unknown): void {
		for (const listener of this.errorListeners) {
			listener(error);
		}
	}
}

function subscribe<T>(listeners: Set<T>, listener: T): Unsubscribe {
	listeners.add(listener);
	return () => {
		listeners.delete(listener);
	};
}

export class FakeTransportFactory {
	readonly transports: FakeTransport[] = [];
	readonly requests: TransportConnectOptions[] = [];
	fail = false;

	readonly factory: TransportFactory = (options) => {
		this.requests.push(options);
		if (this.fail) {
			throw new Error('factory failed');
		}
		const transport = new FakeTransport();
		this.transports.push(transport);
		return transport;
	};
}
