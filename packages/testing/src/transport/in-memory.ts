// SPDX-License-Identifier: Apache-2.0
// SPDX-FileCopyrightText: 2026 Rodolfo Carrillo

import type {
	Transport,
	TransportCloseEvent,
	TransportConnectOptions,
	TransportFactory,
	TransportState,
	Unsubscribe,
} from '@ocpptools/core';

import { InMemoryTransportError } from '../errors.js';
import { flushMicrotasks } from '../clock/fake-clock.js';

export type InMemoryDelivery = 'manual' | 'microtask';

export interface InMemoryTransportOptions {
	/** How frames are delivered. Defaults to `microtask`. */
	readonly delivery?: InMemoryDelivery;
	/** Maximum queued frames per direction. Defaults to 1024. */
	readonly maxQueue?: number;
	/** Maximum drain rounds before failing. Defaults to 1000. */
	readonly maxFlushRounds?: number;
}

export interface InMemoryTransportPairOptions extends InMemoryTransportOptions {
	/** Opens the pair on the next microtask. Defaults to `false` in `createPair`. */
	readonly autoOpen?: boolean;
	/** Connection options associated with the pair. The factory fills them. */
	readonly connect?: TransportConnectOptions;
}

export interface InMemoryTransport extends Transport {
	/**
	 * Texts accepted by `send()`, including failed and dropped sends. Sends
	 * rejected before acceptance (not open or queue overflow) are not included.
	 */
	readonly sent: readonly string[];
	/** Texts delivered to this endpoint. */
	readonly received: readonly string[];
	/** Frames waiting in this endpoint's outbound queue. */
	readonly queued: number;
}

export type InMemoryDirection = 'client-to-server' | 'server-to-client';

export interface InMemoryFrame {
	readonly direction: InMemoryDirection;
	readonly text: string;
	readonly status: 'delivered' | 'dropped' | 'failed';
}

export interface InMemoryTransportLink {
	readonly frames: readonly InMemoryFrame[];
	readonly clientState: TransportState;
	readonly serverState: TransportState;
	/** Opens both endpoints and fires `onOpen`. Idempotent. */
	open(): void;
	/** Closes both endpoints cleanly and discards queued frames. */
	close(code?: number, reason?: string): void;
	/** Fails both endpoints, then closes them with code 1006 and `wasClean: false`. */
	fail(error: unknown): void;
	/** Drops the next queued frame in that direction. Returns whether one existed. */
	dropNext(direction: InMemoryDirection): boolean;
	/** Makes the next `send()` in that direction throw. Returns whether it was armed. */
	failNext(direction: InMemoryDirection, error: unknown): boolean;
	/** Drains queues and microtasks with the configured budget. */
	flush(): Promise<void>;
}

export interface InMemoryTransportPair {
	readonly client: InMemoryTransport;
	readonly server: InMemoryTransport;
	readonly link: InMemoryTransportLink;
	/** Connection options, or `undefined` for a direct pair without `connect`. */
	readonly options: TransportConnectOptions | undefined;
}

export interface InMemoryTransportHubOptions extends InMemoryTransportOptions {
	/**
	 * Opens factory-created pairs on the next microtask. Defaults to `false`:
	 * call `nextPair()`, attach listeners, then `link.open()`.
	 */
	readonly autoOpen?: boolean;
}

export interface InMemoryTransportHub {
	/** Pairs created directly or by the factory. */
	readonly pairs: readonly InMemoryTransportPair[];
	/** Connection requests received by the factory, in order. */
	readonly requests: readonly TransportConnectOptions[];
	/** Creates one pair per connection and queues it for `nextPair()`. */
	readonly factory: TransportFactory;
	/** Creates a pair without queueing it. */
	createPair(options?: InMemoryTransportPairOptions): InMemoryTransportPair;
	/** Waits for the next factory-created pair, before opening it. */
	nextPair(): Promise<InMemoryTransportPair>;
	/** Shorthand for `nextPair().then((pair) => pair.server)`. */
	nextServer(): Promise<InMemoryTransport>;
	/** Drains every pair. */
	flush(): Promise<void>;
	/** Closes every pair and rejects pending `nextPair()` waiters. */
	closeAll(code?: number, reason?: string): void;
}

type End = 'client' | 'server';

interface QueueEntry {
	readonly direction: InMemoryDirection;
	readonly text: string;
}

interface ArmedFailure {
	readonly error: unknown;
}

interface LinkOptions extends InMemoryTransportOptions {
	readonly connect?: TransportConnectOptions;
}

interface Waiter {
	readonly resolve: (pair: InMemoryTransportPair) => void;
	readonly reject: (error: unknown) => void;
}

function subscribe<T>(listeners: Set<T>, listener: T): Unsubscribe {
	listeners.add(listener);
	return () => {
		listeners.delete(listener);
	};
}

function positiveInteger(value: unknown, fallback: number, name: string): number {
	if (value === undefined) return fallback;
	if (typeof value !== 'number' || !Number.isSafeInteger(value) || value <= 0) {
		throw new InMemoryTransportError('invalid-option', `${name} must be a positive safe integer`);
	}
	return value;
}

function deliveryOption(value: unknown): InMemoryDelivery {
	if (value === undefined) return 'microtask';
	if (value === 'manual' || value === 'microtask') return value;
	throw new InMemoryTransportError('invalid-option', 'delivery must be "microtask" or "manual"');
}

function directionFor(end: End): InMemoryDirection {
	return end === 'client' ? 'client-to-server' : 'server-to-client';
}

function safeMessage(error: unknown): string {
	try {
		return error instanceof Error && typeof error.message === 'string'
			? error.message
			: 'Transport failed';
	} catch {
		return 'Transport failed';
	}
}

class InMemoryTransportImpl implements InMemoryTransport {
	private stateValue: TransportState = 'connecting';
	private readonly openListeners = new Set<() => void>();
	private readonly messageListeners = new Set<(data: string) => void>();
	private readonly errorListeners = new Set<(error: unknown) => void>();
	private readonly closeListeners = new Set<(event: TransportCloseEvent) => void>();

	constructor(
		private readonly link: InMemoryLinkImpl,
		private readonly end: End,
	) {}

	get state(): TransportState {
		return this.stateValue;
	}

	get sent(): readonly string[] {
		return [...this.sentValue];
	}

	get received(): readonly string[] {
		return [...this.receivedValue];
	}

	get queued(): number {
		return this.link.queueLength(directionFor(this.end));
	}

	private readonly sentValue: string[] = [];
	private readonly receivedValue: string[] = [];

	send(data: string): void {
		this.link.send(this.end, data);
	}

	close(code = 1000, reason = ''): void {
		this.link.close(code, reason);
	}

	onOpen(listener: () => void): Unsubscribe {
		return subscribe(this.openListeners, listener);
	}

	onMessage(listener: (data: string) => void): Unsubscribe {
		return subscribe(this.messageListeners, listener);
	}

	onError(listener: (error: unknown) => void): Unsubscribe {
		return subscribe(this.errorListeners, listener);
	}

	onClose(listener: (event: TransportCloseEvent) => void): Unsubscribe {
		return subscribe(this.closeListeners, listener);
	}

	setState(state: TransportState): void {
		this.stateValue = state;
	}

	recordSent(text: string): void {
		this.sentValue.push(text);
	}

	deliverMessage(text: string): void {
		this.receivedValue.push(text);
		for (const listener of [...this.messageListeners]) {
			try {
				listener(text);
			} catch (error) {
				this.link.noteListenerError(error);
			}
		}
	}

	emitOpen(): void {
		for (const listener of [...this.openListeners]) {
			try {
				listener();
			} catch (error) {
				this.link.noteListenerError(error);
			}
		}
	}

	emitError(error: unknown): void {
		for (const listener of [...this.errorListeners]) {
			try {
				listener(error);
			} catch (listenerError) {
				this.link.noteListenerError(listenerError);
			}
		}
	}

	emitClose(event: TransportCloseEvent): void {
		for (const listener of [...this.closeListeners]) {
			try {
				listener(event);
			} catch (error) {
				this.link.noteListenerError(error);
			}
		}
	}
}

class InMemoryLinkImpl implements InMemoryTransportLink {
	readonly client: InMemoryTransportImpl;
	readonly server: InMemoryTransportImpl;
	readonly pair: InMemoryTransportPair;

	private readonly delivery: InMemoryDelivery;
	private readonly maxQueue: number;
	private readonly maxFlushRounds: number;
	private readonly queues: Record<InMemoryDirection, QueueEntry[]> = {
		'client-to-server': [],
		'server-to-client': [],
	};
	private readonly framesValue: InMemoryFrame[] = [];
	private readonly failNextArmed: Record<InMemoryDirection, ArmedFailure | undefined> = {
		'client-to-server': undefined,
		'server-to-client': undefined,
	};
	private pumpScheduled = false;
	private dispatchingOpen = false;
	private pendingTerminal: (() => void) | undefined;
	private listenerError: unknown;
	private flushing = false;
	private autoRounds = 0;

	constructor(options: LinkOptions) {
		this.delivery = deliveryOption(options.delivery);
		this.maxQueue = positiveInteger(options.maxQueue, 1024, 'maxQueue');
		this.maxFlushRounds = positiveInteger(options.maxFlushRounds, 1000, 'maxFlushRounds');
		this.client = new InMemoryTransportImpl(this, 'client');
		this.server = new InMemoryTransportImpl(this, 'server');
		this.pair = {
			client: this.client,
			server: this.server,
			link: this,
			options: options.connect,
		};
	}

	get frames(): readonly InMemoryFrame[] {
		return [...this.framesValue];
	}

	get clientState(): TransportState {
		return this.client.state;
	}

	get serverState(): TransportState {
		return this.server.state;
	}

	queueLength(direction: InMemoryDirection): number {
		return this.queues[direction].length;
	}

	send(end: End, text: string): void {
		const sender = this.transport(end);
		if (sender.state !== 'open') {
			throw new InMemoryTransportError('not-open', 'Transport is not open');
		}
		if (typeof text !== 'string') {
			throw new InMemoryTransportError('invalid-option', 'Transport.send expects a string');
		}
		const direction = directionFor(end);
		const failure = this.failNextArmed[direction];
		if (failure !== undefined) {
			this.failNextArmed[direction] = undefined;
			sender.recordSent(text);
			this.framesValue.push({ direction, text, status: 'failed' });
			throw failure.error;
		}
		const queue = this.queues[direction];
		if (queue.length >= this.maxQueue) {
			this.framesValue.push({ direction, text, status: 'failed' });
			throw new InMemoryTransportError(
				'queue-overflow',
				`The ${direction} queue exceeded ${String(this.maxQueue)} frames`,
			);
		}
		sender.recordSent(text);
		queue.push({ direction, text });
		this.schedulePump();
	}

	open(): void {
		if (this.client.state !== 'connecting' || this.server.state !== 'connecting') return;
		this.dispatchingOpen = true;
		this.client.setState('open');
		this.server.setState('open');
		this.client.emitOpen();
		this.server.emitOpen();
		this.dispatchingOpen = false;
		const pending = this.pendingTerminal;
		this.pendingTerminal = undefined;
		if (pending !== undefined) pending();
		this.schedulePump();
	}

	close(code = 1000, reason = ''): void {
		if (this.client.state === 'closed') return;
		const run = (): void => {
			this.closeInternal(code, reason);
		};
		if (this.dispatchingOpen) {
			this.pendingTerminal ??= run;
			return;
		}
		run();
	}

	fail(error: unknown): void {
		if (this.client.state === 'closed') return;
		const run = (): void => {
			this.failInternal(error);
		};
		if (this.dispatchingOpen) {
			this.pendingTerminal ??= run;
			return;
		}
		run();
	}

	dropNext(direction: InMemoryDirection): boolean {
		const entry = this.queues[direction].shift();
		if (entry === undefined) return false;
		this.framesValue.push({ direction, text: entry.text, status: 'dropped' });
		return true;
	}

	failNext(direction: InMemoryDirection, error: unknown): boolean {
		this.failNextArmed[direction] = {
			error: error === undefined ? new Error('The next send was configured to fail') : error,
		};
		return true;
	}

	async flush(): Promise<void> {
		this.flushing = true;
		this.autoRounds = 0;
		try {
			await flushMicrotasks(2);
			let idleRounds = 0;
			for (let round = 0; round < this.maxFlushRounds; round += 1) {
				this.pumpOneRound();
				await flushMicrotasks(2);
				const listenerError = this.takeListenerError();
				if (listenerError !== undefined) throw listenerError;
				if (this.hasQueuedFrames()) {
					idleRounds = 0;
					continue;
				}
				idleRounds += 1;
				if (idleRounds >= 2) return;
			}
			if (this.hasQueuedFrames()) {
				throw new InMemoryTransportError(
					'not-making-progress',
					`The transport did not become idle after ${String(this.maxFlushRounds)} rounds`,
				);
			}
		} finally {
			this.flushing = false;
		}
	}

	noteListenerError(error: unknown): void {
		if (this.listenerError === undefined) this.listenerError = error;
	}

	private takeListenerError(): Error | undefined {
		const error = this.listenerError;
		this.listenerError = undefined;
		if (error === undefined) return undefined;
		return error instanceof Error
			? error
			: new InMemoryTransportError('not-making-progress', 'A listener threw', {
					cause: error,
				});
	}

	private transport(end: End): InMemoryTransportImpl {
		return end === 'client' ? this.client : this.server;
	}

	private hasQueuedFrames(): boolean {
		return this.queues['client-to-server'].length > 0 || this.queues['server-to-client'].length > 0;
	}

	private schedulePump(): void {
		if (this.delivery !== 'microtask' || this.pumpScheduled || this.flushing) return;
		this.pumpScheduled = true;
		void Promise.resolve().then(() => {
			this.pumpScheduled = false;
			if (this.client.state === 'closed' || this.server.state === 'closed') return;
			if (this.flushing) return;
			const worked = this.pumpOneRound();
			if (!worked || !this.hasQueuedFrames()) {
				this.autoRounds = 0;
				return;
			}
			this.autoRounds += 1;
			if (this.autoRounds > this.maxFlushRounds) {
				this.noteListenerError(
					new InMemoryTransportError(
						'not-making-progress',
						'The automatic transport pump is not making progress',
					),
				);
				return;
			}
			this.schedulePump();
		});
	}

	private pumpOneRound(): boolean {
		const clientBudget = this.queues['client-to-server'].length;
		const serverBudget = this.queues['server-to-client'].length;
		if (clientBudget === 0 && serverBudget === 0) return false;
		for (let index = 0; index < clientBudget; index += 1) {
			const entry = this.queues['client-to-server'].shift();
			if (entry !== undefined) this.deliver(entry);
		}
		for (let index = 0; index < serverBudget; index += 1) {
			const entry = this.queues['server-to-client'].shift();
			if (entry !== undefined) this.deliver(entry);
		}
		return true;
	}

	private deliver(entry: QueueEntry): void {
		const peer = entry.direction === 'client-to-server' ? this.server : this.client;
		if (peer.state !== 'open') {
			this.framesValue.push({
				direction: entry.direction,
				text: entry.text,
				status: 'dropped',
			});
			return;
		}
		this.framesValue.push({
			direction: entry.direction,
			text: entry.text,
			status: 'delivered',
		});
		peer.deliverMessage(entry.text);
	}

	private closeInternal(code: number, reason: string): void {
		if (this.client.state === 'closed') return;
		this.client.setState('closing');
		this.server.setState('closing');
		this.discardQueues();
		this.client.setState('closed');
		this.server.setState('closed');
		const event: TransportCloseEvent = {
			code,
			reason,
			// An explicit in-memory close always completes the closing handshake.
			wasClean: true,
		};
		this.client.emitClose(event);
		this.server.emitClose(event);
	}

	private failInternal(error: unknown): void {
		if (this.client.state === 'closed') return;
		this.client.setState('closing');
		this.server.setState('closing');
		this.discardQueues();
		this.client.setState('closed');
		this.server.setState('closed');
		this.client.emitError(error);
		this.server.emitError(error);
		const event: TransportCloseEvent = {
			code: 1006,
			reason: safeMessage(error),
			wasClean: false,
		};
		this.client.emitClose(event);
		this.server.emitClose(event);
	}

	private discardQueues(): void {
		for (const direction of ['client-to-server', 'server-to-client'] as const) {
			for (const entry of this.queues[direction]) {
				this.framesValue.push({ direction, text: entry.text, status: 'dropped' });
			}
			this.queues[direction].length = 0;
		}
		this.failNextArmed['client-to-server'] = undefined;
		this.failNextArmed['server-to-client'] = undefined;
	}
}

class InMemoryTransportHubImpl implements InMemoryTransportHub {
	private readonly pairList: InMemoryTransportPair[] = [];
	private readonly requestList: TransportConnectOptions[] = [];
	private readonly serverQueue: InMemoryTransportPair[] = [];
	private readonly waiters: Waiter[] = [];
	private readonly delivery: InMemoryDelivery;
	private readonly maxQueue: number;
	private readonly maxFlushRounds: number;
	private readonly autoOpen: boolean;
	private closed = false;

	readonly factory: TransportFactory;

	constructor(options: InMemoryTransportHubOptions = {}) {
		this.delivery = deliveryOption(options.delivery);
		this.maxQueue = positiveInteger(options.maxQueue, 1024, 'maxQueue');
		this.maxFlushRounds = positiveInteger(options.maxFlushRounds, 1000, 'maxFlushRounds');
		this.autoOpen = options.autoOpen === true;
		this.factory = (request) => {
			if (this.closed) {
				throw new InMemoryTransportError('closed', 'The transport hub is closed');
			}
			this.requestList.push(request);
			const pair = this.makePair({
				delivery: this.delivery,
				maxQueue: this.maxQueue,
				maxFlushRounds: this.maxFlushRounds,
				connect: request,
			});
			this.pairList.push(pair);
			this.enqueuePair(pair);
			if (this.autoOpen) this.scheduleOpen(pair);
			return pair.client;
		};
	}

	get pairs(): readonly InMemoryTransportPair[] {
		return [...this.pairList];
	}

	get requests(): readonly TransportConnectOptions[] {
		return [...this.requestList];
	}

	createPair(options: InMemoryTransportPairOptions = {}): InMemoryTransportPair {
		if (this.closed) {
			throw new InMemoryTransportError('closed', 'The transport hub is closed');
		}
		const pair = this.makePair({
			delivery: options.delivery ?? this.delivery,
			maxQueue: options.maxQueue ?? this.maxQueue,
			maxFlushRounds: options.maxFlushRounds ?? this.maxFlushRounds,
			connect: options.connect,
		});
		this.pairList.push(pair);
		if (options.autoOpen === true) this.scheduleOpen(pair);
		return pair;
	}

	nextPair(): Promise<InMemoryTransportPair> {
		if (this.closed) {
			return Promise.reject(new InMemoryTransportError('closed', 'The transport hub is closed'));
		}
		if (this.serverQueue.length > 0) {
			const pair = this.serverQueue.shift();
			if (pair !== undefined) return Promise.resolve(pair);
		}
		return new Promise<InMemoryTransportPair>((resolve, reject) => {
			this.waiters.push({ resolve, reject });
		});
	}

	nextServer(): Promise<InMemoryTransport> {
		return this.nextPair().then((pair) => pair.server);
	}

	async flush(): Promise<void> {
		await Promise.all(this.pairList.map((pair) => pair.link.flush()));
	}

	closeAll(code?: number, reason?: string): void {
		this.closed = true;
		this.serverQueue.length = 0;
		for (const pair of this.pairList) pair.link.close(code, reason);
		const error = new InMemoryTransportError('closed', 'The transport hub is closed');
		for (const waiter of this.waiters.splice(0)) waiter.reject(error);
	}

	private makePair(options: InMemoryTransportPairOptions): InMemoryTransportPair {
		const link = new InMemoryLinkImpl({
			delivery: options.delivery,
			maxQueue: options.maxQueue,
			maxFlushRounds: options.maxFlushRounds,
			connect: options.connect,
		});
		return link.pair;
	}

	private scheduleOpen(pair: InMemoryTransportPair): void {
		void Promise.resolve().then(() => {
			if (!this.closed) pair.link.open();
		});
	}

	private enqueuePair(pair: InMemoryTransportPair): void {
		const waiter = this.waiters.shift();
		if (waiter !== undefined) {
			waiter.resolve(pair);
			return;
		}
		this.serverQueue.push(pair);
	}
}

/** Creates a directly connected in-memory transport pair. */
export function createInMemoryTransportPair(
	options: InMemoryTransportPairOptions = {},
): InMemoryTransportPair {
	const link = new InMemoryLinkImpl({
		delivery: options.delivery,
		maxQueue: options.maxQueue,
		maxFlushRounds: options.maxFlushRounds,
		connect: options.connect,
	});
	if (options.autoOpen === true) {
		void Promise.resolve().then(() => link.open());
	}
	return link.pair;
}

/** Creates a hub that can produce one in-memory pair per connection. */
export function createInMemoryTransportHub(
	options: InMemoryTransportHubOptions = {},
): InMemoryTransportHub {
	return new InMemoryTransportHubImpl(options);
}
