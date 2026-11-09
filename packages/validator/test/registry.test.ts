// SPDX-License-Identifier: Apache-2.0
// SPDX-FileCopyrightText: 2026 Rodolfo Carrillo

import { describe, expect, it, vi } from 'vitest';

import { SchemaLoadError, createSchemaRegistry, schemaFileName } from '../src/index.js';

describe('schemaFileName', () => {
	it('names the files of OCPP 1.6J', () => {
		expect(schemaFileName('1.6', 'BootNotification', 'request')).toBe('BootNotification.json');
		expect(schemaFileName('1.6', 'BootNotification', 'response')).toBe(
			'BootNotificationResponse.json',
		);
	});

	it('names the files of OCPP 2.0.1', () => {
		expect(schemaFileName('2.0.1', 'BootNotification', 'request')).toBe(
			'BootNotificationRequest.json',
		);
		expect(schemaFileName('2.0.1', 'BootNotification', 'response')).toBe(
			'BootNotificationResponse.json',
		);
	});

	it('refuses an action that is not made of letters and digits', () => {
		for (const action of ['', '../Secret', 'a/b', 'a.b', 'a b', 'Boot-Notification', 'ñ']) {
			expect(schemaFileName('2.0.1', action, 'request')).toBeUndefined();
			expect(schemaFileName('1.6', action, 'response')).toBeUndefined();
		}
	});

	it('refuses an action that is not text', () => {
		for (const action of [42, null, true, undefined]) {
			expect(schemaFileName('2.0.1', action as unknown as string, 'request')).toBeUndefined();
		}
	});

	it('refuses an unsupported version', () => {
		expect(schemaFileName('2.1.0' as never, 'Heartbeat', 'request')).toBeUndefined();
	});
});

describe('createSchemaRegistry', () => {
	it('rejects an unsupported version explicitly', () => {
		expect(() =>
			createSchemaRegistry({ version: '2.1.0' as never, load: () => undefined }),
		).toThrow('Unsupported OCPP version: 2.1.0. Supported versions: 1.6 and 2.0.1');
	});

	it('loads the schema of a request and of a response from different files', async () => {
		const load = vi.fn((fileName: string) => ({ file: fileName }));
		const registry = createSchemaRegistry({ version: '2.0.1', load });
		expect(await registry.get('Heartbeat', 'request')).toEqual({ file: 'HeartbeatRequest.json' });
		expect(await registry.get('Heartbeat', 'response')).toEqual({ file: 'HeartbeatResponse.json' });
		expect(load.mock.calls).toEqual([['HeartbeatRequest.json'], ['HeartbeatResponse.json']]);
	});

	it('uses the names of the version it was created for', async () => {
		const load = vi.fn((fileName: string) => fileName);
		await createSchemaRegistry({ version: '1.6', load }).get('Heartbeat', 'request');
		expect(load).toHaveBeenCalledWith('Heartbeat.json');
	});

	it('waits for a loader that returns a promise', async () => {
		const registry = createSchemaRegistry({
			version: '1.6',
			load: () => Promise.resolve({ type: 'object' }),
		});
		expect(await registry.get('Heartbeat', 'request')).toEqual({ type: 'object' });
	});

	it('answers undefined for an action that is not a plain name, without loading', () => {
		const load = vi.fn();
		const registry = createSchemaRegistry({ version: '2.0.1', load });
		expect(registry.get('../Secret', 'request')).toBeUndefined();
		expect(registry.get('', 'response')).toBeUndefined();
		expect(load).not.toHaveBeenCalled();
	});

	it('passes on undefined from the loader as an unknown action', async () => {
		const registry = createSchemaRegistry({ version: '2.0.1', load: () => undefined });
		expect(await registry.get('Nope', 'request')).toBeUndefined();
	});

	it('loads each file once, also when asked at the same time', async () => {
		const load = vi.fn(() => Promise.resolve({ type: 'object' }));
		const registry = createSchemaRegistry({ version: '2.0.1', load });
		const [first, second] = await Promise.all([
			registry.get('Heartbeat', 'request'),
			registry.get('Heartbeat', 'request'),
		]);
		expect(first).toBe(second);
		await registry.get('Heartbeat', 'request');
		expect(load).toHaveBeenCalledTimes(1);
	});

	describe('with a list of files', () => {
		const files = ['HeartbeatRequest.json', '2.0.1/HeartbeatResponse.json', '1.6/Authorize.json'];

		it('accepts a bare file name and a name after the version', async () => {
			const load = vi.fn((fileName: string) => fileName);
			const registry = createSchemaRegistry({ version: '2.0.1', load, files });
			expect(await registry.get('Heartbeat', 'request')).toBe('HeartbeatRequest.json');
			expect(await registry.get('Heartbeat', 'response')).toBe('HeartbeatResponse.json');
		});

		it('does not call the loader for a file that is not listed', () => {
			const load = vi.fn();
			const registry = createSchemaRegistry({ version: '2.0.1', load, files });
			expect(registry.get('Authorize', 'request')).toBeUndefined();
			expect(load).not.toHaveBeenCalled();
		});

		it('ignores the files listed for another version', () => {
			const load = vi.fn();
			const registry = createSchemaRegistry({
				version: '2.0.1',
				load,
				files: ['1.6/Heartbeat.json'],
			});
			expect(registry.get('Heartbeat', 'request')).toBeUndefined();
			const registry16 = createSchemaRegistry({
				version: '1.6',
				load,
				files: ['2.0.1/HeartbeatResponse.json'],
			});
			expect(registry16.get('Heartbeat', 'response')).toBeUndefined();
			expect(load).not.toHaveBeenCalled();
		});

		it('takes any iterable', async () => {
			const registry = createSchemaRegistry({
				version: '1.6',
				load: () => 'schema',
				files: new Set(['Heartbeat.json']),
			});
			expect(await registry.get('Heartbeat', 'request')).toBe('schema');
		});
	});

	describe('when loading fails', () => {
		it('rejects with a SchemaLoadError that keeps the cause', async () => {
			const cause = new Error('network down');
			const registry = createSchemaRegistry({
				version: '2.0.1',
				load: () => Promise.reject(cause),
			});
			const error: unknown = await Promise.resolve(registry.get('Heartbeat', 'request')).catch(
				(failure: unknown) => failure,
			);
			expect(error).toBeInstanceOf(SchemaLoadError);
			expect(error).toBeInstanceOf(Error);
			expect(error).toMatchObject({
				name: 'SchemaLoadError',
				fileName: 'HeartbeatRequest.json',
				message: 'Could not load the schema HeartbeatRequest.json',
				cause,
			});
		});

		it('treats a loader that throws as a failed load', async () => {
			const cause = new Error('boom');
			const registry = createSchemaRegistry({
				version: '2.0.1',
				load: () => {
					throw cause;
				},
			});
			await expect(registry.get('Heartbeat', 'request')).rejects.toMatchObject({ cause });
		});

		it('tries again on the next call', async () => {
			const load = vi
				.fn<(fileName: string) => Promise<unknown>>()
				.mockRejectedValueOnce(new Error('first'))
				.mockResolvedValueOnce({ type: 'object' });
			const registry = createSchemaRegistry({ version: '2.0.1', load });
			await expect(registry.get('Heartbeat', 'request')).rejects.toBeInstanceOf(SchemaLoadError);
			expect(await registry.get('Heartbeat', 'request')).toEqual({ type: 'object' });
			expect(load).toHaveBeenCalledTimes(2);
		});

		it('tries again after a loader that throws', async () => {
			const load = vi
				.fn<(fileName: string) => unknown>()
				.mockImplementationOnce(() => {
					throw new Error('first');
				})
				.mockReturnValueOnce({ type: 'object' });
			const registry = createSchemaRegistry({ version: '2.0.1', load });
			await expect(registry.get('Heartbeat', 'request')).rejects.toBeInstanceOf(SchemaLoadError);
			expect(await registry.get('Heartbeat', 'request')).toEqual({ type: 'object' });
		});
	});
});
