// SPDX-License-Identifier: Apache-2.0
// SPDX-FileCopyrightText: 2026 Rodolfo Carrillo

import type { MessageId } from './frame.js';

/** Returns a new message ID on every call. Inject your own for deterministic tests. */
export type MessageIdGenerator = () => MessageId;

/**
 * The part of the Web Crypto `Crypto` interface used to make IDs. Declared here
 * because this package builds without DOM or Node typings.
 */
export interface RandomUuidSource {
	randomUUID(): string;
}

/**
 * Creates a generator of random UUID message IDs. A UUID is 36 characters, the
 * maximum length of an OCPP message ID.
 *
 * Without an argument it uses `globalThis.crypto`, which Node 22 and browsers
 * provide (browsers only in secure contexts). Pass a source, or use your own
 * `MessageIdGenerator`, in an environment without it.
 *
 * @throws {Error} When no source is given and `globalThis.crypto.randomUUID` is unavailable.
 */
export function createMessageIdGenerator(
	source: RandomUuidSource | undefined = (globalThis as { crypto?: RandomUuidSource }).crypto,
): MessageIdGenerator {
	if (typeof source?.randomUUID !== 'function') {
		throw new Error('crypto.randomUUID is not available; pass a RandomUuidSource');
	}
	return () => source.randomUUID();
}
