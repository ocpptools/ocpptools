// SPDX-License-Identifier: Apache-2.0
// SPDX-FileCopyrightText: 2026 Rodolfo Carrillo

import type { Storage } from '@ocpptools/core';

/** The synchronous storage surface this adapter needs, usually `localStorage`. */
export interface WebStorageLike {
	getItem(key: string): string | null;
	setItem(key: string, value: string): void;
	removeItem(key: string): void;
}

/**
 * Adapts `localStorage` (or another synchronous Web Storage) to the
 * asynchronous `Storage` interface.
 */
export function createWebStorage(storage?: WebStorageLike): Storage {
	const backing = storage ?? (globalThis as { localStorage?: WebStorageLike }).localStorage;
	if (backing === undefined) {
		throw new Error('localStorage is not available in this environment');
	}
	return {
		get: (key) => Promise.resolve(backing.getItem(key) ?? undefined),
		set: (key, value) => {
			backing.setItem(key, value);
			return Promise.resolve();
		},
		delete: (key) => {
			backing.removeItem(key);
			return Promise.resolve();
		},
	};
}
