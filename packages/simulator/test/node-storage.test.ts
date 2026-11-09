// SPDX-License-Identifier: Apache-2.0
// SPDX-FileCopyrightText: 2026 Rodolfo Carrillo

import { createHash } from 'node:crypto';
import { mkdir, mkdtemp, readdir, rm, stat } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';

import { afterEach, describe, expect, it } from 'vitest';

import { createFileStorage, createMemoryStorage } from '@ocpptools/simulator/node';

const directories: string[] = [];

afterEach(async () => {
	await Promise.all(
		directories.splice(0).map((directory) => rm(directory, { recursive: true, force: true })),
	);
});

async function temporaryDirectory(): Promise<string> {
	const directory = await mkdtemp(join(tmpdir(), 'ocpptools-node-storage-'));
	directories.push(directory);
	return directory;
}

function hashedName(key: string): string {
	return createHash('sha256').update(key).digest('hex');
}

describe('memory storage', () => {
	it('round-trips values and treats missing keys as undefined', async () => {
		const storage = createMemoryStorage();
		await expect(storage.get('missing')).resolves.toBeUndefined();
		await storage.set('cp001', '{"ready":true}');
		await expect(storage.get('cp001')).resolves.toBe('{"ready":true}');
		await storage.set('cp001', '{"ready":false}');
		await expect(storage.get('cp001')).resolves.toBe('{"ready":false}');
		await storage.delete('cp001');
		await expect(storage.get('cp001')).resolves.toBeUndefined();
		await expect(storage.delete('missing')).resolves.toBeUndefined();
	});
});

describe('file storage', () => {
	it('round-trips values and treats missing keys as undefined', async () => {
		const directory = await temporaryDirectory();
		const storage = createFileStorage(directory);
		await expect(storage.get('missing')).resolves.toBeUndefined();
		await expect(storage.delete('missing')).resolves.toBeUndefined();
		await storage.set('cp001', '{"ready":true}');
		await expect(storage.get('cp001')).resolves.toBe('{"ready":true}');
		await storage.set('cp001', '{"ready":false}');
		await expect(storage.get('cp001')).resolves.toBe('{"ready":false}');
		await storage.delete('cp001');
		await expect(storage.get('cp001')).resolves.toBeUndefined();
		await expect(storage.delete('cp001')).resolves.toBeUndefined();
	});

	it('creates nested directories on the first write', async () => {
		const root = await temporaryDirectory();
		const directory = join(root, 'a', 'b', 'c');
		const storage = createFileStorage(directory);
		await storage.set('key', 'value');
		await expect(storage.get('key')).resolves.toBe('value');
		expect((await stat(directory)).isDirectory()).toBe(true);
	});

	it('hashes keys and never writes outside the directory', async () => {
		const directory = await temporaryDirectory();
		const storage = createFileStorage(directory);
		const keys = ['../escape', '..\\escape', 'a/b', 'a\\b', '..'];
		for (const key of keys) {
			await storage.set(key, key);
			await expect(storage.get(key)).resolves.toBe(key);
		}
		const entries = await readdir(directory);
		expect(entries.sort()).toEqual(keys.map(hashedName).sort());
		expect(entries.every((entry) => /^[a-f0-9]{64}$/.test(entry))).toBe(true);
	});

	it('uses 0600 for files and 0700 for the directory on POSIX', async () => {
		if (process.platform === 'win32') return;
		const directory = await temporaryDirectory();
		const storage = createFileStorage(directory);
		await storage.set('key', 'value');
		const file = await stat(join(directory, hashedName('key')));
		const folder = await stat(directory);
		expect(file.mode & 0o777).toBe(0o600);
		expect(folder.mode & 0o777).toBe(0o700);
	});

	it('keeps concurrent writes isolated', async () => {
		const directory = await temporaryDirectory();
		const storage = createFileStorage(directory);
		await Promise.all(
			Array.from({ length: 20 }, (_, index) =>
				storage.set(`key-${String(index)}`, `value-${String(index)}`),
			),
		);
		for (let index = 0; index < 20; index += 1) {
			await expect(storage.get(`key-${String(index)}`)).resolves.toBe(`value-${String(index)}`);
		}
		await Promise.all(
			Array.from({ length: 5 }, (_, index) => storage.set('shared', `value-${String(index)}`)),
		);
		await expect(storage.get('shared')).resolves.toMatch(/^value-\d$/);
	}, 20_000);

	it('cleans up the temporary file when the rename fails', async () => {
		const directory = await temporaryDirectory();
		const storage = createFileStorage(directory);
		const target = join(directory, hashedName('key'));
		await mkdir(target);
		await expect(storage.set('key', 'value')).rejects.toThrow();
		await expect(storage.get('key')).rejects.toThrow();
		expect(await readdir(directory)).toEqual([hashedName('key')]);
	});

	it('rejects an invalid directory', () => {
		expect(() => createFileStorage('')).toThrow('non-empty string');
		expect(() => createFileStorage('   ')).toThrow('non-empty string');
		expect(() => createFileStorage(null as unknown as string)).toThrow('non-empty string');
	});

	it('leaves the directory resolvable from a relative path', async () => {
		const directory = await temporaryDirectory();
		const relativeDirectory = resolve(directory);
		const storage = createFileStorage(relativeDirectory);
		await storage.set('../key', 'value');
		await expect(storage.get('../key')).resolves.toBe('value');
	});
});
