// SPDX-License-Identifier: Apache-2.0
// SPDX-FileCopyrightText: 2026 Rodolfo Carrillo

import type { OcppSubprotocol } from './version.js';

/** Removes the listener it was returned for. Calling it more than once is harmless. */
export type Unsubscribe = () => void;

/** The lifecycle of a {@link Transport}, in the order it moves through. */
export type TransportState = 'connecting' | 'open' | 'closing' | 'closed';

export interface TransportCloseEvent {
	/** The WebSocket close code, for example `1000` for a normal closure. */
	readonly code: number;
	readonly reason: string;
	/** Whether the closing handshake completed. */
	readonly wasClean: boolean;
}

/**
 * One text connection to an OCPP peer, usually a WebSocket. It carries OCPP-J
 * frames as strings, so it knows nothing about OCPP itself.
 *
 * Implementations adapt a concrete WebSocket for a browser, Node, or a test.
 * A transport starts in `connecting`, moves to `open`, and ends in `closed`. It
 * is not reused: to reconnect, create a new one with a {@link TransportFactory}.
 */
export interface Transport {
	readonly state: TransportState;
	/**
	 * Sends one text frame.
	 *
	 * @throws {Error} When the transport is not `open`.
	 */
	send(data: string): void;
	/** Starts the closing handshake. Does nothing once the transport is `closing` or `closed`. */
	close(code?: number, reason?: string): void;
	/** Called once, when the transport reaches `open`. */
	onOpen(listener: () => void): Unsubscribe;
	/** Called for every text frame received. */
	onMessage(listener: (data: string) => void): Unsubscribe;
	/** Called for a connection error. A `close` event follows when the connection ends. */
	onError(listener: (error: unknown) => void): Unsubscribe;
	/** Called once, when the transport reaches `closed`. */
	onClose(listener: (event: TransportCloseEvent) => void): Unsubscribe;
}

export interface TransportConnectOptions {
	/** The full WebSocket URL, including the charge point identity in its path. */
	readonly url: string;
	/** The subprotocol to request during the WebSocket handshake. */
	readonly subprotocol: OcppSubprotocol;
}

/** Starts connecting and returns the new {@link Transport} in the `connecting` state. */
export type TransportFactory = (options: TransportConnectOptions) => Transport;
