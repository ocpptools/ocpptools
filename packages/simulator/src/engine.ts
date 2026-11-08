// SPDX-License-Identifier: Apache-2.0
// SPDX-FileCopyrightText: 2026 Rodolfo Carrillo

import {
	createMessageIdGenerator,
	type CallFrame,
	type JsonObject,
	type MessageId,
	type OcppSubprotocol,
	type OcppVersion,
	type TransportCloseEvent,
} from '@ocpptools/core';

import { Scheduler } from './clock.js';
import { Connection, type ReconnectOptions } from './connection.js';
import { SimulatorError, SimulatorValidationError, errorSnapshot } from './errors.js';
import { EventEmitter, type SimulatorEvent } from './events.js';
import { History, type SimulatorLogEntry } from './log.js';
import { Metrics, type SimulatorMetrics } from './metrics.js';
import { OutboundPipeline } from './outbound.js';
import { OfflineQueue, type QueuedCall } from './queue.js';
import { Rpc, type CallHandler, type PendingCall } from './rpc.js';
import { defaultRandom, type RandomSource } from './random.js';
import type {
	BootOptions,
	BootSnapshot,
	CommonSimulatorOptions,
	FaultConfig,
	PersistenceOptions,
	SimulatorConfig,
	SimulatorStateBase,
} from './state.js';
import type { InboundResponseMode, ValidateMode } from './events.js';
import {
	cloneJson,
	validateSnapshot,
	type LoadResult,
	type RestoreResult,
	type SaveResult,
	type SimulatorPersistedConfig,
	type SimulatorSnapshot,
} from './persistence.js';

export interface BootResponse {
	readonly status: string;
	readonly intervalMs?: number;
	readonly currentTime?: string;
}

const AUTOSAVE_EVENTS = new Set([
	'queue',
	'connector',
	'evse',
	'transaction',
	'reservation',
	'boot',
	'scenario',
	'fault',
	'validation',
	'log',
]);

export interface EngineProfile<S extends object> {
	readonly version: OcppVersion;
	readonly subprotocol: OcppSubprotocol;
	createState(): S;
	bootPayload(reason?: string): JsonObject;
	applyBootResponse(response: JsonObject): BootResponse;
	register(engine: EngineBase<S>): void;
	onReady(engine: EngineBase<S>, reason: 'open' | 'boot-accepted'): void | Promise<void>;
	onTransportClose(engine: EngineBase<S>): void;
	/** Validates and rebuilds the profile state from a snapshot. */
	restoreState?(value: unknown): S;
	/** Rearms profile timers and derived state after a restore. */
	onRestored?(engine: EngineBase<S>): void;
}

export type EngineState<S extends object> = SimulatorStateBase & S;

/**
 * The shared engine. It owns the environment and the protocol-independent
 * lifecycle; the profile owns the version-specific state and flows.
 */
export class EngineBase<S extends object> {
	readonly version: OcppVersion;
	private stateValue: S;
	get state(): S {
		return this.stateValue;
	}
	readonly scheduler: Scheduler;
	readonly events: EventEmitter;
	readonly history: History;
	readonly rpc: Rpc;
	readonly metrics: Metrics;
	private readonly profile: EngineProfile<S>;
	private readonly options: CommonSimulatorOptions;
	private readonly connection: Connection;
	private readonly queue: OfflineQueue;
	private readonly outbound: OutboundPipeline;
	private readonly messageIds: () => MessageId;
	private readonly random: RandomSource;
	private readonly validateOutbound:
		| ((frame: CallFrame) => readonly string[] | null | Promise<readonly string[] | null>)
		| undefined;
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
	private autoSaveCancel: (() => void) | undefined;
	private bootPromise: Promise<BootResponse> | undefined;
	private readonly persistence: PersistenceOptions | undefined;
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
		this.persistence = options.persistence;
		this.validationMode = options.validation?.mode ?? 'warn';
		this.validateOutbound = options.validation?.validateOutbound;
		this.inboundResponseMode = options.inbound?.policy ?? 'auto';
		this.queue = new OfflineQueue({
			maxEntries: options.queue?.maxEntries ?? 500,
			now: () => this.scheduler.now(),
		});
		this.outbound = new OutboundPipeline({
			scheduler: this.scheduler,
			events: this.events,
			history: this.history,
			random: this.random,
			getFaults: () => this.faults,
			getEpoch: () => this.session,
			isOpen: () => this.connection.isOpen(),
			sendText: (text) => this.connection.sendText(text),
		});
		this.stateValue = profile.createState();

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
			outbound: (input) => this.outbound.deliver(input),
			validate: (frame) => this.validateFrame(frame),
		});
		profile.register(this);
		this.events.on('pending', (event) => {
			if (event.phase === 'resolved' && event.rttMs !== undefined) {
				this.metrics.recordRtt(event.action, event.rttMs);
				this.emitMetrics();
			}
			if (event.phase === 'rejected' || event.phase === 'timeout') {
				this.metrics.recordError(this.scheduler.now());
				this.emitMetrics();
			}
		});
		this.events.on('error', (event) => {
			if (event.countsAsError === false) {
				return;
			}
			this.metrics.recordError(this.scheduler.now());
			this.emitMetrics();
		});
		if (this.persistence?.autoSave === true) {
			this.events.onAny((event) => {
				if (AUTOSAVE_EVENTS.has(event.type)) {
					this.scheduleAutoSave();
				}
			});
		}
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

	setReconnectOptions(options: ReconnectOptions): void {
		this.assertActive();
		this.connection.setReconnectOptions(options);
	}

	dispose(): void {
		if (this.disposed) {
			return;
		}
		this.disposed = true;
		this.ready = false;
		this.outbound.cancelAll();
		this.cancelAutoSave();
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
		const messageId = this.rpc.reserveMessageId();
		try {
			const frame: CallFrame = [2, messageId, action, payload];
			if (this.needsValidation()) {
				await this.validateFrame(frame);
				this.assertActive();
			}
			if (this.isReady) {
				this.rpc.trackResult(messageId);
				this.rpc.releaseMessageId(messageId);
				try {
					await this.rpc.sendRawFrame(frame);
					return 'sent';
				} catch (error) {
					if (!(
						error instanceof SimulatorError &&
						(error.code === 'disconnected' || error.code === 'not-connected')
					)) {
						this.report(error);
						throw error;
					}
				}
			}
			this.rpc.trackResult(messageId);
			this.rpc.releaseMessageId(messageId);
			this.assertActive();
			const dropped = this.queue.enqueue(action, payload, messageId);
			this.emitQueue('enqueued', this.queue.size);
			if (dropped !== undefined) {
				this.emitQueue('overflow', this.queue.size, dropped);
			}
			return 'queued';
		} catch (error) {
			this.rpc.releaseMessageId(messageId);
			throw error;
		}
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

	getPendingCalls(): readonly PendingCall[] {
		return this.rpc.getPending();
	}

	clearPendingCalls(reason = 'Pending calls cleared'): void {
		this.assertActive();
		this.rpc.cancelAll(reason, 'cancelled');
	}

	getQueue(): readonly QueuedCall[] {
		return this.queue.get();
	}

	getQueueLength(): number {
		return this.queue.size;
	}

	clearQueue(): void {
		this.queue.clear();
		this.emitQueue('cleared', 0);
	}

	getHistory(): readonly SimulatorLogEntry[] {
		return this.history.get();
	}

	clearHistory(): void {
		this.history.clear();
	}

	getMetrics(): SimulatorMetrics {
		return this.metrics.snapshot(this.scheduler.now());
	}

	resetMetrics(): void {
		this.metrics.reset();
		this.emitMetrics();
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

	getConfig(): SimulatorConfig {
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

	async load(): Promise<LoadResult> {
		const persistence = this.persistence;
		if (persistence === undefined) {
			return { loaded: false };
		}
		if (this.disposed) {
			return { loaded: false };
		}
		let raw: string | undefined;
		try {
			raw = await persistence.storage.get(persistence.key);
		} catch (error) {
			this.report(error);
			return { loaded: false, error: errorSnapshot(error) };
		}
		if (raw === undefined) {
			return { loaded: false };
		}
		let parsed: unknown;
		try {
			parsed = JSON.parse(raw) as unknown;
		} catch {
			const invalid = new SimulatorError('invalid-snapshot', 'The stored snapshot is not JSON');
			this.report(invalid);
			return { loaded: false, error: errorSnapshot(invalid) };
		}
		const result = this.restoreSnapshot(parsed);
		if (!result.restored) {
			return result.error === undefined
				? { loaded: false }
				: { loaded: false, error: result.error };
		}
		return { loaded: true, snapshot: parsed as SimulatorSnapshot };
	}

	async save(): Promise<SaveResult> {
		const persistence = this.persistence;
		if (persistence === undefined || this.disposed) {
			const error = errorSnapshot(
				new SimulatorError('persistence-failed', 'Persistence is not configured'),
			);
			return { saved: false, error };
		}
		let snapshot: SimulatorSnapshot;
		try {
			snapshot = this.exportSnapshot();
		} catch (error) {
			this.report(error);
			return { saved: false, error: errorSnapshot(error) };
		}
		try {
			await persistence.storage.set(persistence.key, JSON.stringify(snapshot));
			this.events.emit({
				type: 'notice',
				at: this.scheduler.now(),
				level: 'success',
				message: 'Snapshot saved',
				code: 'persistence-saved',
			});
			return { saved: true };
		} catch (error) {
			this.report(error);
			return { saved: false, error: errorSnapshot(error) };
		}
	}

	exportSnapshot(): SimulatorSnapshot {
		this.assertActive();
		const persistedConfig: SimulatorPersistedConfig = {
			faults: { ...this.faults },
			validationMode: this.validationMode,
			inboundResponseMode: this.inboundResponseMode,
			heartbeatIntervalMs: this.heartbeatIntervalMs,
			meterValueIntervalMs: this.meterIntervalMs,
		};
		const snapshot: SimulatorSnapshot = {
			snapshotVersion: 1,
			protocol: this.version,
			savedAt: this.scheduler.now(),
			config: persistedConfig,
			state: cloneJson(this.state) as unknown as JsonObject,
			queue: this.queue.snapshot(),
			...(this.persistence?.includeHistory === true
				? { history: cloneJson(this.history.get()) }
				: {}),
		};
		return snapshot;
	}

	restoreSnapshot(snapshot: unknown): RestoreResult {
		if (this.disposed) {
			return {
				restored: false,
				error: errorSnapshot(new SimulatorError('disposed', 'The simulator is disposed')),
			};
		}
		const previousState = this.stateValue;
		const previousFaults = { ...this.faults };
		const previousValidationMode = this.validationMode;
		const previousInboundResponseMode = this.inboundResponseMode;
		const previousHeartbeatIntervalMs = this.heartbeatIntervalMs;
		const previousMeterIntervalMs = this.meterIntervalMs;
		const previousQueue = this.queue.snapshot();
		const previousHistory = this.history.get();
		const previousClockOffsetMs = this.clockOffsetMs;
		try {
			validateSnapshot(snapshot, this.version);
			if (this.profile.restoreState === undefined) {
				throw new SimulatorError('invalid-snapshot', 'This profile cannot restore state');
			}
			const next = this.profile.restoreState(snapshot.state);
			this.stateValue = next;
			this.faults = { ...snapshot.config.faults };
			this.validationMode = snapshot.config.validationMode;
			this.inboundResponseMode = snapshot.config.inboundResponseMode;
			this.heartbeatIntervalMs = snapshot.config.heartbeatIntervalMs;
			this.meterIntervalMs = snapshot.config.meterValueIntervalMs;
			this.queue.restore(snapshot.queue);
			for (const entry of this.queue.get()) {
				this.rpc.trackResult(entry.messageId);
			}
			if (snapshot.history !== undefined) {
				this.history.restore(snapshot.history);
			}
			this.clockOffsetMs = 0;
			this.profile.onRestored?.(this);
			this.emitQueue('restored', this.queue.size);
			this.events.emit({
				type: 'notice',
				at: this.scheduler.now(),
				level: 'success',
				message: 'Snapshot restored',
				code: 'persistence-restored',
			});
			return { restored: true };
		} catch (error) {
			this.stateValue = previousState;
			this.faults = previousFaults;
			this.validationMode = previousValidationMode;
			this.inboundResponseMode = previousInboundResponseMode;
			this.heartbeatIntervalMs = previousHeartbeatIntervalMs;
			this.meterIntervalMs = previousMeterIntervalMs;
			this.queue.restore(previousQueue);
			this.history.restore(previousHistory);
			this.clockOffsetMs = previousClockOffsetMs;
			const normalized =
				error instanceof SimulatorError
					? error
					: new SimulatorError('invalid-snapshot', 'The snapshot is invalid', {
							cause: error,
						});
			return { restored: false, error: errorSnapshot(normalized) };
		}
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
			this.reportBackgroundError(error);
		}
	}

	private async flushQueue(): Promise<void> {
		if (!this.isReady) {
			return;
		}
		for (let round = 0; round < 10 && this.isReady && this.queue.size > 0; round += 1) {
			const result = await this.queue.flush((text) =>
				this.rpc.sendQueuedFrame(text).then(() => undefined),
			);
			if (result.error !== undefined && this.isReady) {
				this.report(result.error);
			}
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
			try {
				await this.rpc.sendCall('Heartbeat', {});
				this.metrics.recordHeartbeat(interval, this.scheduler.now());
				this.emitMetrics();
			} catch (error) {
				this.reportBackgroundError(error);
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
			void this.bootNotification().catch((error: unknown) => this.reportBackgroundError(error));
		}, delay);
	}

	private cancelBootRetry(): void {
		this.bootRetryCancel?.();
		this.bootRetryCancel = undefined;
	}

	private scheduleAutoSave(): void {
		if (this.disposed || this.persistence?.autoSave !== true) {
			return;
		}
		this.cancelAutoSave();
		const delay = Math.max(0, this.persistence.saveDebounceMs ?? 1000);
		try {
			this.autoSaveCancel = this.scheduler.setTimeout(() => {
				this.autoSaveCancel = undefined;
				void this.save();
			}, delay);
		} catch {
			this.autoSaveCancel = undefined;
		}
	}

	private cancelAutoSave(): void {
		this.autoSaveCancel?.();
		this.autoSaveCancel = undefined;
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
			void this.bootNotification().catch((error: unknown) => this.reportBackgroundError(error));
		}
	}

	private handleTransportClose(event: TransportCloseEvent): void {
		this.session += 1;
		this.outbound.cancelAll();
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

	private async validateFrame(frame: CallFrame): Promise<void> {
		const validate = this.validateOutbound;
		if (this.validationMode === 'off' || validate === undefined) {
			return;
		}
		let errors: readonly string[] | null;
		try {
			errors = await validate(frame);
		} catch (error) {
			this.report(error);
			if (this.validationMode === 'block') {
				throw new SimulatorValidationError(frame[2], [
					error instanceof Error ? error.message : 'The validation callback failed',
				]);
			}
			return;
		}
		if (errors === null || errors.length === 0) {
			return;
		}
		const blocked = this.validationMode === 'block';
		const at = this.scheduler.now();
		this.events.emit({
			type: 'validation',
			at,
			mode: this.validationMode,
			action: frame[2],
			errors: [...errors],
			blocked,
		});
		const entry = {
			at,
			direction: 'system' as const,
			messageType: 'SYSTEM' as const,
			action: `[VALIDATION] ${frame[2]}`,
			messageId: frame[1],
			level: blocked ? ('error' as const) : ('warning' as const),
			code: blocked ? 'validation-blocked' : 'validation-warning',
			data: { errors: [...errors] },
		};
		this.history.add(entry);
		this.events.emit({ type: 'log', at, entry });
		this.events.emit({
			type: 'notice',
			at,
			level: blocked ? 'error' : 'warning',
			message: `Outbound ${frame[2]} failed validation`,
			code: 'validation',
		});
		if (blocked) {
			this.metrics.recordError(at);
			this.emitMetrics();
			throw new SimulatorValidationError(frame[2], errors);
		}
	}

	private needsValidation(): boolean {
		return this.validationMode !== 'off' && this.validateOutbound !== undefined;
	}

	private emitMetrics(): void {
		const at = this.scheduler.now();
		this.events.emit({
			type: 'metrics',
			at,
			errorCountLastMinute: this.metrics.snapshot(at).errorCountLastMinute,
		});
	}

	private reportBackgroundError(error: unknown): void {
		if (error instanceof SimulatorError) {
			const code = error.code;
			if (
				code === 'validation-blocked' ||
				code === 'timeout' ||
				code === 'call-error' ||
				code === 'send-failed' ||
				code === 'invalid-response' ||
				code === 'cancelled' ||
				code === 'disconnected'
			) {
				return;
			}
		}
		this.report(error);
	}

	private report(error: unknown): void {
		if (this.disposed) {
			return;
		}
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
