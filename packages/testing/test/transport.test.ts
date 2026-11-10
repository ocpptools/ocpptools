// SPDX-License-Identifier: Apache-2.0
// SPDX-FileCopyrightText: 2026 Rodolfo Carrillo

import { describe, expect, it } from 'vitest';

import { flushMicrotasks } from '../src/clock/fake-clock.js';
import {
	createInMemoryTransportHub,
	createInMemoryTransportPair,
	type InMemoryTransportPair,
} from '../src/transport/in-memory.js';

function pair(options?: Parameters<typeof createInMemoryTransportPair>[0]): InMemoryTransportPair {
	return createInMemoryTransportPair(options);
}

describe('in-memory transport', () => {
	it('starts connecting, opens once and becomes idempotent', () => {
		const value = pair();
		expect(value.client.state).toBe('connecting');
		expect(value.server.state).toBe('connecting');
		let clientOpens = 0;
		let serverOpens = 0;
		value.client.onOpen(() => {
			clientOpens += 1;
		});
		value.server.onOpen(() => {
			serverOpens += 1;
		});
		value.link.open();
		value.link.open();
		expect(value.client.state).toBe('open');
		expect(value.server.state).toBe('open');
		expect(clientOpens).toBe(1);
		expect(serverOpens).toBe(1);
	});

	it('rejects sends before open and after close', () => {
		const value = pair();
		expect(() => value.client.send('before')).toThrow(
			expect.objectContaining({ code: 'not-open' }),
		);
		value.link.open();
		value.link.close();
		expect(() => value.client.send('after')).toThrow(expect.objectContaining({ code: 'not-open' }));
	});

	it('delivers FIFO in manual mode and tracks queues', async () => {
		const value = pair({ delivery: 'manual' });
		const received: string[] = [];
		value.server.onMessage((text) => received.push(text));
		value.link.open();
		value.client.send('a');
		value.client.send('b');
		expect(value.client.queued).toBe(2);
		expect(received).toEqual([]);
		expect(value.client.sent).toEqual(['a', 'b']);
		await value.link.flush();
		expect(received).toEqual(['a', 'b']);
		expect(value.server.received).toEqual(['a', 'b']);
		expect(value.client.queued).toBe(0);
		expect(value.link.frames.map((frame) => frame.status)).toEqual(['delivered', 'delivered']);
	});

	it('delivers in both directions and in microtask mode', async () => {
		const value = pair();
		const toServer: string[] = [];
		const toClient: string[] = [];
		value.server.onMessage((text) => toServer.push(text));
		value.client.onMessage((text) => toClient.push(text));
		value.link.open();
		value.client.send('request');
		value.server.send('response');
		expect(toServer).toEqual([]);
		expect(toClient).toEqual([]);
		await value.link.flush();
		expect(toServer).toEqual(['request']);
		expect(toClient).toEqual(['response']);
	});

	it('unsubscribes listeners and ignores double unsubscribe', async () => {
		const value = pair();
		let calls = 0;
		const unsubscribe = value.server.onMessage(() => {
			calls += 1;
		});
		unsubscribe();
		unsubscribe();
		value.link.open();
		value.client.send('ignored');
		await value.link.flush();
		expect(calls).toBe(0);
	});

	it('closes both endpoints from the link and from either endpoint', () => {
		const first = pair();
		const firstEvents: string[] = [];
		first.client.onClose((event) => firstEvents.push(`client:${String(event.wasClean)}`));
		first.server.onClose((event) => firstEvents.push(`server:${String(event.wasClean)}`));
		first.link.open();
		first.link.close(1000, 'done');
		first.link.close(1000, 'again');
		expect(first.client.state).toBe('closed');
		expect(first.server.state).toBe('closed');
		expect(firstEvents).toEqual(['client:true', 'server:true']);

		const second = pair();
		const secondEvents: string[] = [];
		second.client.onClose(() => secondEvents.push('client'));
		second.server.onClose(() => secondEvents.push('server'));
		second.link.open();
		second.client.close();
		expect(secondEvents).toEqual(['client', 'server']);
		expect(second.server.state).toBe('closed');
	});

	it('fails both endpoints with onError and an unclean close', () => {
		const value = pair();
		const events: string[] = [];
		value.client.onError((error) => events.push(`client-error:${String(error)}`));
		value.server.onError((error) => events.push(`server-error:${String(error)}`));
		value.client.onClose((event) => events.push(`client-close:${String(event.code)}`));
		value.server.onClose((event) =>
			events.push(`server-close:${String(event.code)}:${String(event.wasClean)}`),
		);
		value.link.open();
		value.link.fail(new Error('boom'));
		expect(events).toEqual([
			'client-error:Error: boom',
			'server-error:Error: boom',
			'client-close:1006',
			'server-close:1006:false',
		]);
		expect(() => value.client.send('after')).toThrow(expect.objectContaining({ code: 'not-open' }));
	});

	it('defers a close requested inside onOpen until both ends opened', () => {
		const value = pair();
		const events: string[] = [];
		value.client.onOpen(() => {
			events.push('client-open');
			value.client.close();
		});
		value.server.onOpen(() => events.push('server-open'));
		value.client.onClose(() => events.push('client-close'));
		value.server.onClose(() => events.push('server-close'));
		value.link.open();
		expect(events).toEqual(['client-open', 'server-open', 'client-close', 'server-close']);
	});

	it('does not throw from close when listeners throw, and surfaces it once from flush', async () => {
		const value = pair();
		let serverClosed = false;
		value.client.onClose(() => {
			throw new Error('close listener failed');
		});
		value.server.onClose(() => {
			serverClosed = true;
		});
		value.link.open();
		expect(() => value.link.close()).not.toThrow();
		expect(serverClosed).toBe(true);
		await expect(value.link.flush()).rejects.toThrow('close listener failed');
		await expect(value.link.flush()).resolves.toBeUndefined();
	});

	it('reports an explicit close with a non-standard code as clean', () => {
		const value = pair();
		let clean: boolean | undefined;
		value.client.onClose((event) => {
			clean = event.wasClean;
		});
		value.link.open();
		value.link.close(4000, 'application close');
		expect(clean).toBe(true);
	});

	it('does not emit error events when fail follows close', () => {
		const value = pair();
		let errors = 0;
		value.client.onError(() => {
			errors += 1;
		});
		value.server.onError(() => {
			errors += 1;
		});
		value.link.open();
		value.link.close();
		value.link.fail(new Error('late'));
		expect(errors).toBe(0);
	});

	it('resets the automatic pump budget between idle periods', async () => {
		const value = pair({ maxFlushRounds: 2 });
		const received: string[] = [];
		value.server.onMessage((text) => received.push(text));
		value.link.open();
		for (const text of ['a', 'b', 'c']) {
			value.client.send(text);
			await flushMicrotasks(2);
		}
		await expect(value.link.flush()).resolves.toBeUndefined();
		expect(received).toEqual(['a', 'b', 'c']);
	});

	it('rejects invalid transport options', () => {
		expect(() => pair({ delivery: 'later' as never })).toThrow(
			expect.objectContaining({ code: 'invalid-option' }),
		);
		expect(() => pair({ maxQueue: 0 })).toThrow(
			expect.objectContaining({ code: 'invalid-option' }),
		);
		expect(() => pair({ maxFlushRounds: 1.5 })).toThrow(
			expect.objectContaining({ code: 'invalid-option' }),
		);
	});

	it('drops the next queued frame immediately', async () => {
		const value = pair({ delivery: 'manual' });
		const received: string[] = [];
		value.server.onMessage((text) => received.push(text));
		value.link.open();
		expect(value.link.dropNext('client-to-server')).toBe(false);
		value.client.send('a');
		expect(value.link.dropNext('client-to-server')).toBe(true);
		expect(value.client.queued).toBe(0);
		await value.link.flush();
		expect(received).toEqual([]);
		expect(value.link.frames.at(-1)).toMatchObject({ text: 'a', status: 'dropped' });
	});

	it('fails the next send without affecting queued frames', async () => {
		const value = pair({ delivery: 'manual' });
		const received: string[] = [];
		value.server.onMessage((text) => received.push(text));
		value.link.open();
		value.client.send('ok');
		expect(value.link.failNext('client-to-server', new Error('injected'))).toBe(true);
		expect(() => value.client.send('bad')).toThrow('injected');
		expect(value.client.sent).toEqual(['ok', 'bad']);
		expect(value.client.queued).toBe(1);
		await value.link.flush();
		expect(received).toEqual(['ok']);
		expect(value.link.frames.map((frame) => frame.status)).toEqual(['failed', 'delivered']);
	});

	it('enforces maxQueue per direction without recording overflow sends', () => {
		const value = pair({ delivery: 'manual', maxQueue: 1 });
		value.link.open();
		value.client.send('a');
		expect(() => value.client.send('b')).toThrow(
			expect.objectContaining({ code: 'queue-overflow' }),
		);
		expect(value.client.sent).toEqual(['a']);
		expect(value.client.queued).toBe(1);
	});

	it('detects an infinite ping-pong in flush', async () => {
		const value = pair({ delivery: 'manual', maxFlushRounds: 2 });
		value.server.onMessage(() => value.server.send('echo'));
		value.client.onMessage(() => value.client.send('echo'));
		value.link.open();
		value.client.send('start');
		await expect(value.link.flush()).rejects.toMatchObject({
			code: 'not-making-progress',
		});
	});

	it('opens autoOpen pairs on a microtask and can be closed before it fires', async () => {
		const opened = pair({ autoOpen: true });
		expect(opened.client.state).toBe('connecting');
		await flushMicrotasks(1);
		expect(opened.client.state).toBe('open');

		const closed = pair({ autoOpen: true });
		closed.link.close();
		await flushMicrotasks(1);
		expect(closed.client.state).toBe('closed');
	});

	it('creates factory pairs, records requests and exposes options', async () => {
		const hub = createInMemoryTransportHub();
		const request = { url: 'ws://in-memory/CP-1', subprotocol: 'ocpp1.6' as const };
		const client = hub.factory(request);
		const value = await hub.nextPair();
		expect(value.client).toBe(client);
		expect(value.options).toEqual(request);
		expect(hub.requests).toEqual([request]);
		expect(value.client.state).toBe('connecting');
		value.link.open();
		expect(value.client.state).toBe('open');
	});

	it('queues nextPair waiters FIFO and rejects them on closeAll', async () => {
		const hub = createInMemoryTransportHub();
		const first = hub.nextPair();
		const second = hub.nextPair();
		const firstClient = hub.factory({ url: 'ws://first', subprotocol: 'ocpp1.6' });
		const firstPair = await first;
		expect(firstPair.client).toBe(firstClient);
		let secondResolved = false;
		void second.then(() => {
			secondResolved = true;
		});
		await flushMicrotasks(2);
		expect(secondResolved).toBe(false);
		const secondClient = hub.factory({ url: 'ws://second', subprotocol: 'ocpp2.0.1' });
		const secondPair = await second;
		expect(secondPair.client).toBe(secondClient);

		const pending = hub.nextPair();
		hub.closeAll();
		await expect(pending).rejects.toMatchObject({ code: 'closed' });
	});

	it('inherits hub options, lets pairs override them and excludes direct pairs from nextPair', async () => {
		const hub = createInMemoryTransportHub({ delivery: 'manual', maxQueue: 1 });
		const direct = hub.createPair({ maxQueue: 2 });
		direct.link.open();
		direct.client.send('a');
		direct.client.send('b');
		expect(direct.client.queued).toBe(2);

		const defaultPair = hub.createPair();
		defaultPair.link.open();
		defaultPair.client.send('a');
		expect(() => defaultPair.client.send('b')).toThrow(
			expect.objectContaining({ code: 'queue-overflow' }),
		);

		const factoryClient = hub.factory({ url: 'ws://x', subprotocol: 'ocpp1.6' });
		const factoryPair = await hub.nextPair();
		expect(factoryPair.client).toBe(factoryClient);
		expect(factoryPair).not.toBe(direct);
	});

	it('rejects invalid sends and undefined failNext errors', () => {
		const value = pair();
		value.link.open();
		expect(() => (value.client.send as (data: unknown) => void)(123)).toThrow(
			expect.objectContaining({ code: 'invalid-option' }),
		);
		expect(value.link.failNext('client-to-server', undefined)).toBe(true);
		expect(() => value.client.send('next')).toThrow('The next send was configured to fail');
	});

	it('surfaces throwing open and error listeners without breaking close', async () => {
		const openPair = pair();
		openPair.client.onOpen(() => {
			throw new Error('open listener failed');
		});
		openPair.link.open();
		expect(openPair.client.state).toBe('open');
		await expect(openPair.link.flush()).rejects.toThrow('open listener failed');

		const errorPair = pair();
		errorPair.client.onError(() => {
			throw new Error('error listener failed');
		});
		expect(() => errorPair.link.fail(new Error('boom'))).not.toThrow();
		expect(errorPair.client.state).toBe('closed');
		expect(errorPair.server.state).toBe('closed');
		await expect(errorPair.link.flush()).rejects.toThrow('error listener failed');
	});

	it('rejects hub operations after closeAll and opens autoOpen pairs only if open', async () => {
		const hub = createInMemoryTransportHub();
		const auto = hub.createPair({ autoOpen: true });
		hub.factory({ url: 'ws://queued', subprotocol: 'ocpp1.6' });
		hub.closeAll();
		await flushMicrotasks(1);
		expect(auto.client.state).toBe('closed');
		expect(() => hub.createPair()).toThrow(expect.objectContaining({ code: 'closed' }));
		expect(() => hub.factory({ url: 'ws://x', subprotocol: 'ocpp1.6' })).toThrow(
			expect.objectContaining({ code: 'closed' }),
		);
		await expect(hub.nextPair()).rejects.toMatchObject({ code: 'closed' });
	});

	it('resolves nextServer with the next factory server', async () => {
		const hub = createInMemoryTransportHub();
		const serverPromise = hub.nextServer();
		const client = hub.factory({ url: 'ws://x', subprotocol: 'ocpp1.6' });
		const server = await serverPromise;
		expect(server.state).toBe('connecting');
		expect(hub.pairs[0]?.client).toBe(client);
	});

	it('flushes direct and factory pairs together', async () => {
		const hub = createInMemoryTransportHub();
		const direct = hub.createPair();
		const directReceived: string[] = [];
		direct.server.onMessage((text) => directReceived.push(text));
		direct.link.open();
		direct.client.send('direct');

		const factoryClient = hub.factory({ url: 'ws://x', subprotocol: 'ocpp1.6' });
		const factoryPair = await hub.nextPair();
		const factoryReceived: string[] = [];
		factoryPair.server.onMessage((text) => factoryReceived.push(text));
		factoryPair.link.open();
		factoryClient.send('factory');

		await hub.flush();
		expect(directReceived).toEqual(['direct']);
		expect(factoryReceived).toEqual(['factory']);
	});
});
