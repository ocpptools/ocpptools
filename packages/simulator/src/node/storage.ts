// SPDX-License-Identifier: Apache-2.0
// SPDX-FileCopyrightText: 2026 Rodolfo Carrillo

import { createHash, randomUUID } from 'node:crypto';
import { mkdir, readFile, rename, unlink, writeFile } from 'node:fs/promises';
import { join, resolve } from 'node:path';
import { setTimeout as sleep } from 'node:timers/promises';

import type { Storage } from '@ocpptools/core';

const RETRY_LIMIT = 5;
const RETRY_BASE_MS = 50;
const RETRY_MAX_MS = 1000;

/** Creates an in-memory `Storage` backed by a `Map`. */
export function createMemoryStorage(): Storage {
	const values = new Map<string, string>();
	return {
		get: (key) => Promise.resolve(values.get(key)),
		set: (key, value) => {
			values.set(key, value);
			return Promise.resolve();
		},
		delete: (key) => {
			values.delete(key);
			return Promise.resolve();
		},
	};
}

/**
 * Creates a `Storage` that keeps one file per key under `directory`.
 *
 * Keys are hashed with SHA-256, so a key can never escape the directory. Writes
 * go to a unique temporary file that is renamed over the target, and transient
 * `EPERM`, `EBUSY`, and `EACCES` errors are retried with bounded backoff.
 */
export function createFileStorage(directory: string): Storage {
	if (typeof directory !== 'string' || directory.trim() === '') {
		throw new Error('The storage directory must be a non-empty string');
	}
	const root = resolve(directory);
	return {
		get: async (key) => {
			try {
				return await withRetry(() => readFile(fileFor(root, key), 'utf8'));
			} catch (error) {
				if (isNotFound(error)) return undefined;
				throw error;
			}
		},
		set: async (key, value) => {
			await mkdir(root, { recursive: true, mode: 0o700 });
			const target = fileFor(root, key);
			const temporary = join(root, `.${randomUUID()}.tmp`);
			let pending = true;
			try {
				await writeFile(temporary, value, {
					encoding: 'utf8',
					flag: 'wx',
					mode: 0o600,
				});
				await withRetry(() => rename(temporary, target));
				pending = false;
			} finally {
				if (pending) {
					await unlink(temporary).catch(() => undefined);
				}
			}
		},
		delete: async (key) => {
			const target = fileFor(root, key);
			await withRetry(async () => {
				try {
					await unlink(target);
				} catch (error) {
					if (isNotFound(error)) return;
					throw error;
				}
			});
		},
	};
}

function fileFor(directory: string, key: string): string {
	return join(directory, createHash('sha256').update(key).digest('hex'));
}

async function withRetry<T>(operation: () => Promise<T>): Promise<T> {
	for (let attempt = 0; ; attempt += 1) {
		try {
			return await operation();
		} catch (error) {
			if (attempt >= RETRY_LIMIT || !isRetryable(error)) throw error;
			await sleep(Math.min(RETRY_BASE_MS * 2 ** attempt, RETRY_MAX_MS));
		}
	}
}

function isRetryable(error: unknown): boolean {
	const code = errorCode(error);
	return code === 'EPERM' || code === 'EBUSY' || code === 'EACCES';
}

function isNotFound(error: unknown): boolean {
	return errorCode(error) === 'ENOENT';
}

function errorCode(error: unknown): string | undefined {
	return typeof error === 'object' && error !== null && 'code' in error
		? String((error as { readonly code?: unknown }).code)
		: undefined;
}
