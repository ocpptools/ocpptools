// SPDX-License-Identifier: Apache-2.0
// SPDX-FileCopyrightText: 2026 Rodolfo Carrillo

import { Buffer } from 'node:buffer';
import type { AddressInfo } from 'node:net';
import { fileURLToPath } from 'node:url';

import { expect, test } from '@playwright/test';
import { build } from 'esbuild';
import { WebSocketServer, type RawData } from 'ws';

function textOf(data: RawData): string {
	if (typeof data === 'string') return data;
	if (Buffer.isBuffer(data)) return data.toString('utf8');
	if (Array.isArray(data)) return Buffer.concat(data).toString('utf8');
	return Buffer.from(data).toString('utf8');
}

let bundle = '';

test.beforeAll(async () => {
	const result = await build({
		entryPoints: [fileURLToPath(new URL('../../src/browser/index.ts', import.meta.url))],
		bundle: true,
		format: 'iife',
		globalName: 'OcppBrowser',
		platform: 'browser',
		target: 'es2022',
		write: false,
	});
	const output = result.outputFiles[0];
	if (output === undefined) throw new Error('esbuild produced no output');
	bundle = output.text;
});

test('connects, exchanges a CALL, closes, and reconnects', async ({ page }) => {
	const server = new WebSocketServer({ port: 0 });
	await new Promise<void>((resolve, reject) => {
		server.once('listening', resolve);
		server.once('error', reject);
	});
	const port = (server.address() as AddressInfo).port;
	const receivedByServer: string[] = [];
	server.on('connection', (socket) => {
		socket.on('message', (data) => {
			const text = textOf(data);
			receivedByServer.push(text);
			const frame = JSON.parse(text) as unknown[];
			if (frame[0] === 2) {
				socket.send(JSON.stringify([3, frame[1], { currentTime: '2026-01-01T00:00:00Z' }]));
			}
		});
	});

	try {
		await page.setContent('<!doctype html><html><body></body></html>');
		await page.addScriptTag({ content: bundle });
		const url = `ws://127.0.0.1:${String(port)}`;

		const first = await page.evaluate(
			(wsUrl) =>
				new Promise<{ messages: string[]; events: string[]; state: string }>((resolve, reject) => {
					const browser = (
						globalThis as unknown as {
							OcppBrowser: {
								createWebSocketTransportFactory: () => (options: {
									url: string;
									subprotocol: string;
								}) => {
									state: string;
									onOpen: (listener: () => void) => void;
									onMessage: (listener: (data: string) => void) => void;
									onClose: (listener: (event: { code: number }) => void) => void;
									onError: (listener: (error: unknown) => void) => void;
									send: (data: string) => void;
									close: (code?: number, reason?: string) => void;
								};
							};
						}
					).OcppBrowser;
					const factory = browser.createWebSocketTransportFactory();
					const transport = factory({ url: wsUrl, subprotocol: 'ocpp2.0.1' });
					const messages: string[] = [];
					const events: string[] = [];
					transport.onOpen(() => {
						events.push('open');
						transport.send('[2,"browser-1","Heartbeat",{}]');
					});
					transport.onMessage((message) => {
						messages.push(message);
						events.push('message');
						transport.close(1000, 'done');
					});
					transport.onClose((event) => {
						events.push(`close:${String(event.code)}`);
						resolve({ messages, events, state: transport.state });
					});
					transport.onError((error) => reject(new Error(String(error))));
				}),
			url,
		);

		expect(first.events).toEqual(['open', 'message', 'close:1000']);
		expect(first.state).toBe('closed');
		expect(first.messages).toHaveLength(1);
		const firstReply = JSON.parse(first.messages[0]!) as unknown[];
		expect(firstReply[0]).toBe(3);
		expect(firstReply[1]).toBe('browser-1');
		expect(receivedByServer[0]).toContain('"Heartbeat"');

		const second = await page.evaluate(
			(wsUrl) =>
				new Promise<{ messages: string[]; state: string }>((resolve, reject) => {
					const browser = (
						globalThis as unknown as {
							OcppBrowser: {
								createWebSocketTransportFactory: () => (options: {
									url: string;
									subprotocol: string;
								}) => {
									state: string;
									onOpen: (listener: () => void) => void;
									onMessage: (listener: (data: string) => void) => void;
									onClose: (listener: (event: { code: number }) => void) => void;
									onError: (listener: (error: unknown) => void) => void;
									send: (data: string) => void;
									close: (code?: number, reason?: string) => void;
								};
							};
						}
					).OcppBrowser;
					const factory = browser.createWebSocketTransportFactory();
					const transport = factory({ url: wsUrl, subprotocol: 'ocpp2.0.1' });
					const messages: string[] = [];
					transport.onOpen(() => transport.send('[2,"browser-2","Heartbeat",{}]'));
					transport.onMessage((message) => {
						messages.push(message);
						transport.close();
					});
					transport.onClose(() => resolve({ messages, state: transport.state }));
					transport.onError((error) => reject(new Error(String(error))));
				}),
			url,
		);

		expect(second.state).toBe('closed');
		expect(second.messages).toHaveLength(1);
		const secondReply = JSON.parse(second.messages[0]!) as unknown[];
		expect(secondReply[0]).toBe(3);
		expect(secondReply[1]).toBe('browser-2');
		expect(receivedByServer.filter((text) => text.includes('"Heartbeat"'))).toHaveLength(2);
	} finally {
		for (const client of server.clients) client.terminate();
		await new Promise<void>((resolve) => server.close(() => resolve()));
	}
});
