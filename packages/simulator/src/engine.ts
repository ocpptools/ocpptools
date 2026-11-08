// SPDX-License-Identifier: Apache-2.0
// SPDX-FileCopyrightText: 2026 Rodolfo Carrillo

import {
	createMessageIdGenerator,
	parseFrame,
	type JsonObject,
	type MessageId,
	type OcppSubprotocol,
	type OcppVersion,
	type TransportCloseEvent,
} from '@ocpptools/core';

import { Scheduler } from './clock.js';
import { Connection } from './connection.js';
import { SimulatorError, errorSnapshot } from './errors.js';
import { EventEmitter, type SimulatorEvent } from './events.js';
import { History, type SimulatorLogEntry } from './log.js';
import { Metrics, type SimulatorMetrics } from './metrics.js';
import { OfflineQueue, type QueuedCall } from './queue.js';
import { Rpc, type CallHandler, type PendingCall } from './rpc.js';
import { defaultRandom, type RandomSource } from './random.js';
import type {
	BootOptions,
	BootSnapshot,
	CommonSimulatorOptions,
	FaultConfig,
	SimulatorStateBase,
} from './state.js';
import type { InboundResponseMode, ValidateMode } from './events.js';

export interface BootResponse {
	readonly status: string;
	readonly intervalMs?: number;
	readonly currentTime?: string;
}

export interface EngineProfile<S extends object> {
	readonly version: OcppVersion;
	readonly subprotocol: OcppSubprotocol;
	createState(): S;
	bootPayload(reason?: string): JsonObject;
	applyBootResponse(response: JsonObject): BootResponse;
	register(engine: EngineBase<S>): void;
	onReady(engine: EngineBase<S>, reason: 'open' | 'boot-accepted'): void | Promise<void>;
	onTransportClose(engine: EngineBase<S>): void;
}

export type EngineState<S extends object> = SimulatorStateBase & S;

/**
 * The shared engine. It owns the environment and the protocol-independent
 * lifecycle; the profile owns the version-specific state and flows.
 */
export class EngineBase<S extends object> {
	readonly version: OcppVersion;
	readonly state: S;
	readonly scheduler: Scheduler;
	readonly events: EventEmitter;
	readonly history: History;
	readonly rpc: Rpc;
	readonly metrics: Metrics;
	private readonly profile: EngineProfile<S>;
	private readonly options: CommonSimulatorOptions;
	private readonly connection: Connection;
	private readonly queue: OfflineQueue;
	private readonly messageIds: () => MessageId;
	private readonly random: RandomSource;
	private readonly bootOptions: Required<BootOptions>;
	private boot: BootSnapshot = { status: 'not-booted' };
	private faults: FaultConfig;
	private validationMode: ValidateMode;
	private inboundResponseMode: InboundResponseMode;
	private clockOffsetMs = 0;
	private ready = false;
	private disposed = false;
	private session = 0;
	private heartbeatCancel: (() => void) | undefined;
	private bootRetryCancel: (() => void) | undefined;
	private bootPromise: Promise<BootResponse> | undefined;
	private heartbeatIntervalMs: number;
	private meterIntervalMs: number;

	constructor(profile: EngineProfile<S>, options: CommonSimulatorOptions) {
		this.profile = profile;
		this.options = options;
		this.version = profile.version;
		this.scheduler = new Scheduler(options.clock, {
			onError: (error) => this.report(error),
		});
		this.events = new EventEmitter(() => this.scheduler.now());
		this.history = new History(options.history?.maxEntries);
		this.metrics = new Metrics();
		this.messageIds =
			options.messageIds ??
			createMessageIdGenerator((globalThis as { crypto?: { randomUUID(): string } }).crypto);
		this.random = options.random ?? defaultRandom;
		this.bootOptions = {
			auto: options.boot?.auto ?? true,
			required: options.boot?.required ?? true,
			retryOnPending: options.boot?.retryOnPending ?? true,
			retryIntervalMs: options.boot?.retryIntervalMs ?? 60_000,
		};
		this.heartbeatIntervalMs = options.timing?.heartbeatIntervalMs ?? 60_000;
		this.meterIntervalMs = options.timing?.meterValueIntervalMs ?? 30_000;
		if (options.queue?.flushOn === 'open' && this.bootOptions.required) {
			throw new SimulatorError(
				'invalid-options',
				"flushOn 'open' is not allowed when boot is required",
			);
		}
		this.faults = {
			latencyMs: options.faults?.latencyMs ?? 0,
			dropRate: options.faults?.dropRate ?? 0,
			malformRate: options.faults?.malformRate ?? 0,
		};
		this.validationMode = options.validation?.mode ?? 'warn';
		this.inboundResponseMode = options.inbound?.policy ?? 'auto';
		this.queue = new OfflineQueue({
			maxEntries: options.queue?.maxEntries ?? 500,
			now: () => this.scheduler.now(),
		});
		this.state = profile.createState();

		this.connection = new Connection({
			url: options.url,
			subprotocol: profile.subprotocol,
			transportFactory: options.transport,
			scheduler: this.scheduler,
			events: this.events,
			random: this.random,
			reconnect: options.reconnect,
			onTransportOpen: (attemptId) => this.handleTransportOpen(attemptId),
			onTransportClose: (event) => this.handleTransportClose(event),
			onMessage: (text) => this.rpc.handleText(text),
			onTransportError: (error) => this.report(error),
		});
		this.rpc = new Rpc({
			version: profile.version,
			scheduler: this.scheduler,
			events: this.events,
			history: this.history,
			messageIds: this.messageIds,
			sendText: (text) => Promise.resolve(this.connection.sendText(text)),
			isOpen: () => this.connection.isOpen(),
			timeoutMs: options.timing?.pendingCallTimeoutMs ?? 15_000,
		});
		profile.register(this);
		this.events.on('pending', (event) => {
			if (event.phase === 'resolved' && event.rttMs !== undefined) {
				this.metrics.recordRtt(event.action, event.rttMs);
			}
			if (event.phase === 'rejected' || event.phase === 'timeout') {
				this.metrics.recordError(this.scheduler.now());
			}
		});
	}

	get isReady(): boolean {
		return this.ready && this.connection.isOpen();
	}

	isOpen(): boolean {
		return this.connection.isOpen();
	}

	isConnected(): boolean {
		return this.connection.isOpen();
	}

	isConnecting(): boolean {
		const state = this.connection.getState().state;
		return state === 'connecting' || state === 'reconnecting';
	}

	connect(): void {
		this.assertActive();
		this.connection.connect();
	}

	disconnect(): void {
		this.connection.disconnect();
	}

	dispose(): void {
		if (this.disposed) {
			return;
		}
		this.disposed = true;
		this.ready = false;
		this.stopHeartbeat();
		this.cancelBootRetry();
		this.profile.onTransportClose(this);
		this.rpc.dispose();
		this.connection.dispose();
		this.scheduler.dispose();
		this.events.dispose();
	}

	sendCall(action: string, payload: JsonObject): Promise<JsonObject> {
		try {
			this.assertReady();
			return this.rpc.sendCall(action, payload);
		} catch (error) {
			const rejected = Promise.reject(
				error instanceof Error
					? error
					: new SimulatorError('internal-error', 'The call could not be prepared', {
							cause: error,
						}),
			);
			void rejected.catch(() => undefined);
			return rejected;
		}
	}

	sendCallResult(messageId: MessageId, payload: JsonObject): Promise<boolean> {
		return this.rpc.sendCallResult(messageId, payload);
	}

	sendCallError(
		messageId: MessageId,
		errorCode: string,
		errorDescription: string,
		errorDetails?: JsonObject,
	): Promise<boolean> {
		return this.rpc.sendCallError(messageId, errorCode, errorDescription, errorDetails);
	}

	sendRawFrame(frame: readonly unknown[]): Promise<void> {
		return this.rpc.sendRawFrame(frame);
	}

	sendText(text: string): Promise<void> {
		return this.rpc.sendText(text);
	}

	async sendOrQueue(action: string, payload: JsonObject): Promise<'sent' | 'queued'> {
		this.assertActive();
		if (this.isReady) {
			const messageId = this.messageIds();
			this.rpc.trackResult(messageId);
			await this.rpc.sendRawFrame([2, messageId, action, payload]);
			return 'sent';
		}
		const messageId = this.messageIds();
		const dropped = this.queue.enqueue(action, payload, messageId);
		this.emitQueue('enqueued', this.queue.size);
		if (dropped !== undefined) {
			this.emitQueue('overflow', this.queue.size, dropped);
		}
		return 'queued';
	}

	onCall(action: string, handler: CallHandler): () => void {
		return this.rpc.onCall(action, handler);
	}

	on<K extends SimulatorEvent['type']>(
		type: K,
		listener: (event: Extract<SimulatorEvent, { type: K }>) => void | Promise<void>,
	): () => void {
		return this.events.on(type, listener);
	}

	onAny(listener: (event: SimulatorEvent) => void | Promise<void>): () => void {
		return this.events.onAny(listener);
	}

	getState(): EngineState<S> {
		return clone({
			...this.state,
			version: this.version,
			connection: this.connection.getState(),
			boot: this.boot,
			queueSize: this.queue.size,
			metrics: this.metrics.snapshot(this.scheduler.now()),
			clockOffsetMs: this.clockOffsetMs,
			faults: this.faults,
			validationMode: this.validationMode,
			inboundResponseMode: this.inboundResponseMode,
		});
	}

	getPending(): readonly PendingCall[] {
		return this.rpc.getPending();
	}

	getQueue(): readonly QueuedCall[] {
		return this.queue.get();
	}

	getHistory(): readonly SimulatorLogEntry[] {
		return this.history.get();
	}

	getMetrics(): SimulatorMetrics {
		return this.metrics.snapshot(this.scheduler.now());
	}

	getFaults(): FaultConfig {
		return { ...this.faults };
	}

	setFaults(faults: Partial<FaultConfig>): void {
		const next: FaultConfig = {
			latencyMs: validateFaults(faults.latencyMs ?? this.faults.latencyMs, 0, 60_000),
			dropRate: validateFaults(faults.dropRate ?? this.faults.dropRate, 0, 1),
			malformRate: validateFaults(faults.malformRate ?? this.faults.malformRate, 0, 1),
		};
		this.faults = next;
	}

	getValidationMode(): ValidateMode {
		return this.validationMode;
	}

	setValidationMode(mode: ValidateMode): void {
		if (mode !== 'off' && mode !== 'warn' && mode !== 'block') {
			throw new SimulatorError('invalid-options', 'Invalid validation mode');
		}
		this.validationMode = mode;
	}

	getInboundResponseMode(): InboundResponseMode {
		return this.inboundResponseMode;
	}

	setInboundResponseMode(mode: InboundResponseMode): void {
		if (mode !== 'auto' && mode !== 'reject') {
			throw new SimulatorError('invalid-options', 'Invalid inbound response mode');
		}
		this.inboundResponseMode = mode;
	}

	now(): number {
		return this.scheduler.now();
	}

	ocppNow(): string {
		return new Date(this.scheduler.now() + this.clockOffsetMs).toISOString();
	}

	/**
	 * Sends BootNotification. A forced boot bypasses the accepted short-circuit
	 * and is used by TriggerMessage; an in-flight boot is always shared.
	 */
	async bootNotification(
		options: { force?: boolean; reason?: string } = {},
	): Promise<BootResponse> {
		this.assertActive();
		if (!this.connection.isOpen()) {
			throw new SimulatorError('not-connected', 'The transport is not open');
		}
		if (this.bootPromise !== undefined) {
			return this.bootPromise;
		}
		if (options.force !== true && this.boot.status === 'accepted') {
			return { status: 'Accepted', intervalMs: this.boot.intervalMs };
		}
		const session = this.session;
		this.boot = { status: 'pending' };
		const promise: Promise<BootResponse> = (async () => {
			try {
				const response = await this.rpc.sendCall(
					'BootNotification',
					this.profile.bootPayload(options.reason ?? 'PowerUp'),
				);
				if (session !== this.session || this.disposed) {
					throw new SimulatorError('disconnected', 'Boot response arrived after reset');
				}
				const result = this.profile.applyBootResponse(response);
				const status = result.status;
				if (
					result.intervalMs !== undefined &&
					Number.isFinite(result.intervalMs) &&
					result.intervalMs > 0
				) {
					this.heartbeatIntervalMs = result.intervalMs;
					this.boot = {
						status:
							status === 'Accepted' ? 'accepted' : status === 'Pending' ? 'pending' : 'rejected',
						intervalMs: result.intervalMs,
						lastResponse: clone(response),
					};
				} else {
					this.boot = {
						status:
							status === 'Accepted' ? 'accepted' : status === 'Pending' ? 'pending' : 'rejected',
						lastResponse: clone(response),
					};
				}
				if (result.currentTime !== undefined) {
					const csms = Date.parse(result.currentTime);
					if (Number.isFinite(csms)) {
						this.clockOffsetMs = csms - this.scheduler.now();
					}
				}
				this.events.emit({
					type: 'boot',
					at: this.scheduler.now(),
					status: this.boot.status,
					...(this.boot.intervalMs === undefined ? {} : { intervalMs: this.boot.intervalMs }),
				});
				if (status === 'Accepted') {
					this.startHeartbeat();
					void this.becomeReady('boot-accepted');
				} else if (status === 'Pending' && this.bootOptions.retryOnPending) {
					this.scheduleBootRetry(result.intervalMs ?? this.bootOptions.retryIntervalMs);
				}
				return result;
			} catch (error) {
				if (session === this.session && !this.disposed) {
					this.boot = {
						status: 'error',
						lastError: error instanceof Error ? error.message : 'BootNotification failed',
					};
					this.events.emit({
						type: 'boot',
						at: this.scheduler.now(),
						status: 'error',
						error: {
							name: 'SimulatorError',
							code: error instanceof SimulatorError ? error.code : 'internal-error',
							message: error instanceof Error ? error.message : 'BootNotification failed',
						},
					});
					if (this.bootOptions.retryOnPending) {
						this.scheduleBootRetry(this.bootOptions.retryIntervalMs);
					}
				}
				throw error;
			}
		})().finally(() => {
			if (this.bootPromise === promise) {
				this.bootPromise = undefined;
			}
		});
		this.bootPromise = promise;
		return promise;
	}

	getHeartbeatIntervalMs(): number {
		return this.heartbeatIntervalMs;
	}

	getMeterValueIntervalMs(): number {
		return this.meterIntervalMs;
	}

	setHeartbeatIntervalMs(value: number): void {
		if (!Number.isFinite(value) || value <= 0) {
			throw new SimulatorError('invalid-options', 'Heartbeat interval must be positive');
		}
		this.heartbeatIntervalMs = value;
		if (this.isReady) this.startHeartbeat();
	}

	setMeterValueIntervalMs(value: number): void {
		if (!Number.isFinite(value) || value <= 0) {
			throw new SimulatorError('invalid-options', 'Meter interval must be positive');
		}
		this.meterIntervalMs = value;
	}

	getConfig(): Record<string, unknown> {
		return {
			version: this.version,
			url: this.options.url,
			boot: { ...this.bootOptions },
			queue: { maxEntries: this.options.queue?.maxEntries ?? 500 },
			heartbeatIntervalMs: this.heartbeatIntervalMs,
			meterValueIntervalMs: this.meterIntervalMs,
			ready: this.ready,
		};
	}

	private async becomeReady(reason: 'open' | 'boot-accepted'): Promise<void> {
		if (this.ready || !this.connection.isOpen() || this.disposed) {
			return;
		}
		this.ready = true;
		this.metrics.resetHeartbeat();
		this.startHeartbeat();
		try {
			// Replaying offline events first preserves FIFO: a queued Ended event
			// must reach the CSMS before the fresh Available status.
			await this.flushQueue();
			await this.profile.onReady(this, reason);
		} catch (error) {
			this.report(error);
		}
	}

	private async flushQueue(): Promise<void> {
		if (!this.isReady) {
			return;
		}
		for (let round = 0; round < 10 && this.isReady && this.queue.size > 0; round += 1) {
			const result = await this.queue.flush((text) => {
				const parsed = parseFrame(text);
				if (parsed.ok && parsed.value[0] === 2) {
					this.rpc.trackResult(parsed.value[1]);
				}
				return Promise.resolve(this.connection.sendText(text));
			});
			this.emitQueue('flushed', this.queue.size);
			if (result.remaining === 0 || result.stoppedBy === 'send-failed') {
				break;
			}
		}
	}

	private startHeartbeat(): void {
		this.stopHeartbeat();
		const interval = this.heartbeatIntervalMs;
		if (!Number.isFinite(interval) || interval <= 0) {
			return;
		}
		this.heartbeatCancel = this.scheduler.setInterval(async () => {
			if (!this.isReady) {
				return;
			}
			const at = this.scheduler.now();
			try {
				await this.rpc.sendCall('Heartbeat', {});
				this.metrics.recordHeartbeat(interval, at);
			} catch (error) {
				this.report(error);
			}
		}, interval);
	}

	private stopHeartbeat(): void {
		this.heartbeatCancel?.();
		this.heartbeatCancel = undefined;
		this.metrics.resetHeartbeat();
	}

	private scheduleBootRetry(delayMs: number): void {
		this.cancelBootRetry();
		const delay =
			Number.isFinite(delayMs) && delayMs > 0 ? delayMs : this.bootOptions.retryIntervalMs;
		this.bootRetryCancel = this.scheduler.setTimeout(() => {
			this.bootRetryCancel = undefined;
			void this.bootNotification().catch((error: unknown) => this.report(error));
		}, delay);
	}

	private cancelBootRetry(): void {
		this.bootRetryCancel?.();
		this.bootRetryCancel = undefined;
	}

	private handleTransportOpen(_attemptId: number): void {
		this.session += 1;
		this.ready = false;
		this.bootPromise = undefined;
		this.boot = { status: 'not-booted' };
		this.metrics.resetHeartbeat();
		if (!this.bootOptions.required) {
			void this.becomeReady('open');
		}
		if (this.bootOptions.auto) {
			void this.bootNotification().catch((error: unknown) => this.report(error));
		}
	}

	private handleTransportClose(event: TransportCloseEvent): void {
		this.session += 1;
		this.ready = false;
		this.bootPromise = undefined;
		this.stopHeartbeat();
		this.cancelBootRetry();
		this.rpc.reset('disconnected');
		this.boot = { status: 'not-booted' };
		this.profile.onTransportClose(this);
		if (event.code !== 1000) {
			this.report(
				new SimulatorError('disconnected', `Transport closed with ${String(event.code)}`),
			);
		}
	}

	private emitQueue(
		phase: 'enqueued' | 'replayed' | 'flushed' | 'cleared' | 'overflow' | 'restored',
		size: number,
		dropped?: QueuedCall,
	): void {
		this.events.emit({
			type: 'queue',
			at: this.scheduler.now(),
			phase,
			size,
			...(dropped === undefined ? {} : { frame: dropped.frame }),
		});
	}

	private report(error: unknown): void {
		if (this.disposed) {
			return;
		}
		this.metrics.recordError(this.scheduler.now());
		this.events.emit({
			type: 'error',
			at: this.scheduler.now(),
			error: errorSnapshot(error),
			fatal: false,
		});
		this.history.add({
			at: this.scheduler.now(),
			direction: 'system',
			messageType: 'SYSTEM',
			action: `[ERR] ${error instanceof Error ? error.message : 'Unknown simulator error'}`,
			level: 'error',
		});
	}

	private assertActive(): void {
		if (this.disposed) {
			throw new SimulatorError('disposed', 'The simulator is disposed');
		}
	}

	private assertReady(): void {
		this.assertActive();
		if (!this.isReady) {
			throw new SimulatorError('not-ready', 'The simulator is not ready');
		}
	}
}

function clone<T>(value: T): T {
	return JSON.parse(JSON.stringify(value)) as T;
}

function validateFaults(value: number, min: number, max: number): number {
	if (!Number.isFinite(value) || value < min || value > max) {
		throw new SimulatorError('invalid-options', `Fault value out of range: ${String(value)}`);
	}
	return value;
}
