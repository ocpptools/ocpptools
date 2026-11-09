// SPDX-License-Identifier: Apache-2.0
// SPDX-FileCopyrightText: 2026 Rodolfo Carrillo

/** The Node adapter entrypoint: WebSocket transport, clock, and storage. */
export { nodeClock } from './clock.js';
export { createFileStorage, createMemoryStorage } from './storage.js';
export { createNodeWebSocketTransportFactory } from './web-socket.js';
export type {
	NodeWebSocketCloseEvent,
	NodeWebSocketConstructor,
	NodeWebSocketErrorEvent,
	NodeWebSocketLike,
	NodeWebSocketMessageEvent,
	NodeWebSocketOpenEvent,
} from './web-socket.js';
