// SPDX-License-Identifier: Apache-2.0
// SPDX-FileCopyrightText: 2026 Rodolfo Carrillo

/** The browser adapter entrypoint: WebSocket transport, clock, and storage. */
export { browserClock } from './clock.js';
export { createWebSocketTransportFactory } from './web-socket.js';
export { createWebStorage } from './storage.js';
export type { WebStorageLike } from './storage.js';
