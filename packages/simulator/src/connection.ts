// SPDX-License-Identifier: Apache-2.0
// SPDX-FileCopyrightText: 2026 Rodolfo Carrillo

import {
	OCPP_SUBPROTOCOLS,
	type OcppSubprotocol,
	type Transport,
	type TransportCloseEvent,
	type TransportFactory,
	type Unsubscribe,
} from '@ocpptools/core';

import type { Scheduler } from './clock.js';
import { SimulatorError, errorSnapshot } from './errors.js';
import type { EventEmitter, ConnectionReason, ConnectionState } from './events.js';
import type { RandomSource } from './random.js';

export interface ReconnectOptions {
	readonly enabled?: boolean;
	readonly maxAttempts?: number;
	readonly baseDelayMs?: number;
	readonly maxDelayMs?: number;
	readonly jitter?: boolean;
}

export interface ConnectionSnapshot {
	readonly state: ConnectionState;
	readonly attempt: number;
	readonly retryInMs?: number;
	readonly lastClose?: TransportCloseEvent;
	readonly lastReason?: ConnectionReason;
}

export interface ConnectionOptions {
	readonly url: string;
	readonly subprotocol: OcppSubprotocol;
	readonly transportFactory: TransportFactory;
	readonly scheduler: Scheduler;
	readonly events: EventEmitter;
	readonly random?: RandomSource;
	readonly reconnect?: ReconnectOptions;
	readonly connectTimeoutMs?: number;
	readonly onTransportOpen?: (attempt: number) => void;
	readonly onTransportClose?: (event: TransportCloseEvent, reason: ConnectionReason) => void;
	readonly onMessage?: (text: string, attempt: number) => void;
	readonly onTransportError?: (error: unknown, attempt: number) => void;
}

interface Attempt {
	readonly id: number;
	readonly transport: Transport;
	readonly unsubs: Unsubscribe[];
	phase: 'connecting' | 'open' | 'closed';
	cancelConnectTimeout?: () => void;
}

type ResolvedReconnect = {
	readonly enabled: boolean;
	readonly maxAttempts: number;
	readonly baseDelayMs: number;
	readonly maxDelayMs: number;
	readonly jitter: boolean;
};

/**
 * Owns one transport at a time. It never reuses a Transport: every attempt
 * creates a new one with the factory. The RPC and boot layers are notified
 * through the callbacks and are responsible for their own state.
 */
export class Connection {
	private readonly options: ConnectionOptions;
	private reconnect: ResolvedReconnect;
	private readonly connectTimeoutMs: number;
	private current: Attempt | null = null;
	private nextAttemptId = 1;
	private state: ConnectionState = 'idle';
	private attempt = 0;
	private retryInMs: number | undefined;
	private backoffGeneration = 0;
	private lastClose: TransportCloseEvent | undefined;
	private lastReason: ConnectionReason | undefined;
	private backoffTimer: (() => void) | undefined;
	private manual = false;
	private disposed = false;

	constructor(options: ConnectionOptions) {
		this.options = options;
		this.reconnect = resolveReconnect(options.reconnect);
		this.connectTimeoutMs = resolveConnectTimeout(options.connectTimeoutMs);
		if (typeof options.url !== 'string' || options.url.trim() === '') {
			throw new SimulatorError('invalid-options', 'The WebSocket URL must not be empty');
		}
		if (!(Object.values(OCPP_SUBPROTOCOLS) as readonly string[]).includes(options.subprotocol)) {
			throw new SimulatorError('invalid-options', 'Unsupported OCPP subprotocol');
		}
	}

	getState(): ConnectionSnapshot {
		return {
			state: this.state,
			attempt: this.attempt,
			...(this.retryInMs === undefined ? {} : { retryInMs: this.retryInMs }),
			...(this.lastClose === undefined ? {} : { lastClose: this.lastClose }),
			...(this.lastReason === undefined ? {} : { lastReason: this.lastReason }),
		};
	}

	isOpen(): boolean {
		return this.state === 'connected' && this.current?.phase === 'open';
	}

	isDisposed(): boolean {
		return this.disposed;
	}

	/** Merges reconnect options and reschedules an active backoff when needed. */
	setReconnectOptions(options: ReconnectOptions): void {
		const next = resolveReconnect({
			enabled: options.enabled ?? this.reconnect.enabled,
			maxAttempts: options.maxAttempts ?? this.reconnect.maxAttempts,
			baseDelayMs: options.baseDelayMs ?? this.reconnect.baseDelayMs,
			maxDelayMs: options.maxDelayMs ?? this.reconnect.maxDelayMs,
			jitter: options.jitter ?? this.reconnect.jitter,
		});
		this.reconnect = next;
		if (!next.enabled) {
			this.cancelBackoff();
			if (this.state === 'reconnecting') {
				this.retryInMs = undefined;
				this.transition('disconnected', 'manual');
			}
			return;
		}
		if (this.state !== 'reconnecting' || this.attempt === 0) return;
		if (this.attempt >= next.maxAttempts) {
			this.exhaustReconnect(this.lastReason ?? 'transport-close');
			return;
		}
		const delay = this.reconnectDelay(this.attempt);
		this.retryInMs = delay;
		this.startBackoffTimer(delay, this.lastReason ?? 'transport-close');
	}

	connect(): void {
		this.assertActive();
		if (this.state === 'connecting' || this.state === 'connected') {
			return;
		}
		this.manual = false;
		this.attempt = 0;
		this.retryInMs = undefined;
		this.cancelBackoff();
		this.transition('connecting', 'connect');
		this.openAttempt();
	}

	disconnect(): void {
		this.manual = true;
		this.cancelBackoff();
		this.retryInMs = undefined;
		this.attempt = 0;
		if (this.current !== null) {
			this.finishAttempt(
				this.current,
				{ code: 1000, reason: 'Client disconnect', wasClean: true },
				'manual',
				true,
			);
			return;
		}
		if (this.state !== 'disconnected' && !this.disposed) {
			this.transition('disconnected', 'manual');
		}
	}

	dispose(): void {
		if (this.disposed) {
			return;
		}
		this.manual = true;
		this.disposed = true;
		this.cancelBackoff();
		this.retryInMs = undefined;
		this.attempt = 0;
		if (this.current !== null) {
			this.finishAttempt(
				this.current,
				{ code: 1000, reason: 'Simulator disposed', wasClean: true },
				'disposed',
				true,
			);
			return;
		}
		if (this.state !== 'disconnected') {
			this.transition('disconnected', 'disposed');
		}
	}

	sendText(text: string): void {
		this.assertActive();
		if (!this.isOpen() || this.current === null) {
			throw new SimulatorError('not-connected', 'The transport is not open');
		}
		try {
			this.current.transport.send(text);
		} catch (error) {
			throw new SimulatorError('send-failed', 'The transport rejected the frame', {
				cause: error,
			});
		}
	}

	private openAttempt(): void {
		if (
			this.disposed ||
			this.manual ||
			this.current !== null ||
			(this.state !== 'connecting' && this.state !== 'reconnecting')
		) {
			return;
		}
		this.cancelBackoff();
		let transport: Transport;
		try {
			transport = this.options.transportFactory({
				url: this.options.url,
				subprotocol: this.options.subprotocol,
			});
		} catch (error) {
			this.report(error, 'factory-error');
			if (this.reconnect.enabled && !this.manual) {
				this.scheduleReconnect('factory-error');
			} else {
				this.transition('disconnected', 'factory-error');
			}
			return;
		}

		const attempt: Attempt = {
			id: this.nextAttemptId++,
			transport,
			unsubs: [],
			phase: 'connecting',
		};
		this.current = attempt;
		attempt.unsubs.push(
			transport.onOpen(() => {
				this.handleOpen(attempt);
			}),
			transport.onMessage((data) => {
				if (this.isCurrent(attempt)) {
					this.safeCall(() => this.options.onMessage?.(data, attempt.id));
				}
			}),
			transport.onError((error) => {
				if (this.isCurrent(attempt)) {
					this.report(error, 'transport-error');
					this.safeCall(() => this.options.onTransportError?.(error, attempt.id));
				}
			}),
			transport.onClose((event) => {
				this.handleClose(attempt, event);
			}),
		);

		if (attempt.phase !== 'connecting') {
			return;
		}
		try {
			attempt.cancelConnectTimeout = this.options.scheduler.setTimeout(() => {
				if (this.isCurrent(attempt) && attempt.phase === 'connecting') {
					this.finishAttempt(
						attempt,
						{ code: 1006, reason: 'Connect timeout', wasClean: false },
						'timeout',
						true,
					);
				}
			}, this.connectTimeoutMs);
		} catch (error) {
			this.report(error, 'timeout');
			this.finishAttempt(
				attempt,
				{ code: 1006, reason: 'Connect timeout could not be scheduled', wasClean: false },
				'timeout',
				true,
			);
			return;
		}

		if (transport.state === 'open') {
			this.handleOpen(attempt);
		} else if (transport.state === 'closed') {
			this.handleClose(attempt, { code: 1006, reason: 'Closed before open', wasClean: false });
		}
	}

	private handleOpen(attempt: Attempt): void {
		if (!this.isCurrent(attempt) || attempt.phase !== 'connecting') {
			return;
		}
		attempt.phase = 'open';
		attempt.cancelConnectTimeout?.();
		attempt.cancelConnectTimeout = undefined;
		this.attempt = 0;
		this.retryInMs = undefined;
		this.lastReason = 'transport-open';
		this.transition('connected', 'transport-open');
		if (!this.isCurrent(attempt)) {
			return;
		}
		this.safeCall(() => this.options.onTransportOpen?.(attempt.id));
	}

	private handleClose(attempt: Attempt, event: TransportCloseEvent): void {
		if (!this.isCurrent(attempt)) {
			return;
		}
		this.finishAttempt(attempt, event, 'transport-close', false);
	}

	private finishAttempt(
		attempt: Attempt,
		event: TransportCloseEvent,
		reason: ConnectionReason,
		closeTransport: boolean,
	): void {
		if (attempt.phase === 'closed') {
			return;
		}
		attempt.phase = 'closed';
		attempt.cancelConnectTimeout?.();
		attempt.cancelConnectTimeout = undefined;
		for (const unsubscribe of attempt.unsubs) {
			unsubscribe();
		}
		attempt.unsubs.length = 0;
		if (this.current === attempt) {
			this.current = null;
		}
		this.lastClose = event;
		this.lastReason = reason;
		this.retryInMs = undefined;
		this.transition('disconnected', reason);
		this.safeCall(() => this.options.onTransportClose?.(event, reason));
		if (closeTransport && attempt.transport.state !== 'closed') {
			try {
				// 1006 is reserved for reporting an abnormal close and cannot be
				// sent. Keep it in the synthesized event, close with a valid code.
				attempt.transport.close(1000, event.reason);
			} catch (error) {
				this.report(error, 'transport-error');
			}
		}
		if (this.manual || this.disposed || reason === 'manual' || reason === 'disposed') {
			return;
		}
		if (event.code === 1000) {
			return;
		}
		this.scheduleReconnect(reason);
	}

	private scheduleReconnect(reason: ConnectionReason): void {
		if (!this.reconnect.enabled || this.manual || this.disposed || this.current !== null) {
			return;
		}
		this.cancelBackoff();
		if (this.attempt >= this.reconnect.maxAttempts) {
			this.exhaustReconnect(reason);
			return;
		}
		this.attempt += 1;
		this.retryInMs = this.reconnectDelay(this.attempt);
		this.transition('reconnecting', reason);
		if (
			!this.reconnect.enabled ||
			this.manual ||
			this.disposed ||
			this.current !== null ||
			this.state !== 'reconnecting'
		) {
			return;
		}
		const delay = this.reconnectDelay(this.attempt);
		this.retryInMs = delay;
		this.startBackoffTimer(delay, reason);
	}

	private startBackoffTimer(delay: number, reason: ConnectionReason): void {
		this.cancelBackoff();
		if (!this.reconnect.enabled || this.manual || this.disposed || this.current !== null) {
			return;
		}
		const generation = this.backoffGeneration;
		try {
			this.backoffTimer = this.options.scheduler.setTimeout(() => {
				this.backoffTimer = undefined;
				if (generation !== this.backoffGeneration) return;
				if (
					!this.reconnect.enabled ||
					this.manual ||
					this.disposed ||
					this.current !== null ||
					this.state !== 'reconnecting'
				) {
					return;
				}
				this.retryInMs = undefined;
				this.transition('connecting', reason);
				this.openAttempt();
			}, delay);
		} catch (error) {
			this.report(error, 'timeout');
			this.retryInMs = undefined;
			this.transition('disconnected', 'exhausted');
		}
	}

	private exhaustReconnect(reason: ConnectionReason): void {
		this.cancelBackoff();
		this.retryInMs = undefined;
		this.transition('disconnected', 'exhausted');
		this.options.events.emit({
			type: 'error',
			at: this.options.scheduler.now(),
			error: errorSnapshot(
				new SimulatorError(
					'connection-failed',
					`Could not reconnect after ${this.reconnect.maxAttempts} attempts`,
					{ details: { reason } },
				),
			),
			fatal: true,
		});
	}

	private reconnectDelay(attempt: number): number {
		const raw = Math.min(
			this.reconnect.maxDelayMs,
			this.reconnect.baseDelayMs * 2 ** Math.max(0, attempt - 1),
		);
		if (!this.reconnect.jitter) {
			return raw;
		}
		const sample = this.options.random?.() ?? 0.5;
		const random = Number.isFinite(sample) ? Math.min(1, Math.max(0, sample)) : 0.5;
		const factor = 0.8 + random * 0.4;
		return Math.round(raw * factor);
	}

	private cancelBackoff(): void {
		this.backoffGeneration += 1;
		this.backoffTimer?.();
		this.backoffTimer = undefined;
	}

	private transition(state: ConnectionState, reason: ConnectionReason): void {
		const previous = this.state;
		this.state = state;
		this.lastReason = reason;
		this.options.events.emit({
			type: 'connection',
			at: this.options.scheduler.now(),
			state,
			previous,
			attempt: this.attempt,
			reason,
			...(this.retryInMs === undefined ? {} : { retryInMs: this.retryInMs }),
			...(this.lastClose === undefined ? {} : { close: this.lastClose }),
		});
	}

	private report(error: unknown, reason: ConnectionReason): void {
		this.options.events.emit({
			type: 'error',
			at: this.options.scheduler.now(),
			error: errorSnapshot(error),
			fatal: false,
		});
		void reason;
	}

	private safeCall(callback: () => void): void {
		try {
			callback();
		} catch (error) {
			this.report(error, 'transport-error');
		}
	}

	private isCurrent(attempt: Attempt): boolean {
		return this.current === attempt && attempt.phase !== 'closed' && !this.disposed;
	}

	private assertActive(): void {
		if (this.disposed) {
			throw new SimulatorError('disposed', 'The connection is disposed');
		}
	}
}

function resolveReconnect(options: ReconnectOptions | undefined): ResolvedReconnect {
	const enabled = options?.enabled ?? true;
	const maxAttempts = options?.maxAttempts ?? 5;
	const baseDelayMs = options?.baseDelayMs ?? 1000;
	const maxDelayMs = options?.maxDelayMs ?? 30_000;
	if (!Number.isInteger(maxAttempts) || maxAttempts < 1) {
		throw new SimulatorError('invalid-options', 'maxAttempts must be a positive integer');
	}
	if (!Number.isFinite(baseDelayMs) || baseDelayMs <= 0) {
		throw new SimulatorError('invalid-options', 'baseDelayMs must be positive');
	}
	if (!Number.isFinite(maxDelayMs) || maxDelayMs < baseDelayMs) {
		throw new SimulatorError('invalid-options', 'maxDelayMs must be at least baseDelayMs');
	}
	return { enabled, maxAttempts, baseDelayMs, maxDelayMs, jitter: options?.jitter ?? false };
}

function resolveConnectTimeout(value: number | undefined): number {
	const timeout = value ?? 15_000;
	if (!Number.isFinite(timeout) || timeout <= 0) {
		throw new SimulatorError('invalid-options', 'connectTimeoutMs must be positive');
	}
	return timeout;
}
