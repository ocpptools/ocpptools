// SPDX-License-Identifier: Apache-2.0
// SPDX-FileCopyrightText: 2026 Rodolfo Carrillo

import type { Storage } from '@ocpptools/core';

export class MemoryStorage implements Storage {
	readonly values = new Map<string, string>();
	failGet = false;
	failSet = false;
	failDelete = false;

	get(key: string): Promise<string | undefined> {
		if (this.failGet) return Promise.reject(new Error('get failed'));
		return Promise.resolve(this.values.get(key));
	}

	set(key: string, value: string): Promise<void> {
		if (this.failSet) return Promise.reject(new Error('set failed'));
		this.values.set(key, value);
		return Promise.resolve();
	}

	delete(key: string): Promise<void> {
		if (this.failDelete) return Promise.reject(new Error('delete failed'));
		this.values.delete(key);
		return Promise.resolve();
	}
}
