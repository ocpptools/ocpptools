// SPDX-License-Identifier: Apache-2.0
// SPDX-FileCopyrightText: 2026 Rodolfo Carrillo

/**
 * Asynchronous key-value storage for text values, injected so state can live in
 * `localStorage`, IndexedDB, a file, or memory. Callers serialize their own
 * values, for example with `JSON.stringify`.
 *
 * This is not the DOM `Storage` interface: every method is asynchronous.
 */
export interface Storage {
	/** Resolves to the stored value, or `undefined` when the key is not set. */
	get(key: string): Promise<string | undefined>;
	/** Stores `value` under `key`, replacing any previous value. */
	set(key: string, value: string): Promise<void>;
	/** Removes `key`. Resolves even when the key is not set. */
	delete(key: string): Promise<void>;
}
