// SPDX-License-Identifier: Apache-2.0
// SPDX-FileCopyrightText: 2026 Rodolfo Carrillo

import type { CallFrame, OcppFrame, OcppVersion, TransportCloseEvent } from '@ocpptools/core';

import { errorSnapshot, type SimulatorErrorSnapshot } from './errors.js';
import type { SimulatorLogEntry } from './log.js';

export type ConnectionState = 'idle' | 'connecting' | 'connected' | 'reconnecting' | 'disconnected';
export type MessageDirection = 'sent' | 'received';
export type NoticeLevel = 'info' | 'warning' | 'error' | 'success';
export type ValidateMode = 'off' | 'warn' | 'block';
export type InboundResponseMode = 'auto' | 'reject';

export type ConnectionReason =
	| 'connect'
	| 'transport-open'
	| 'transport-close'
	| 'timeout'
	| 'transport-error'
	| 'factory-error'
	| 'manual'
	| 'exhausted'
	| 'disposed';

export interface ConnectionEvent {
	readonly type: 'connection';
	readonly at: number;
	readonly state: ConnectionState;
	readonly previous: ConnectionState;
	readonly attempt?: number;
	readonly reason?: ConnectionReason;
	readonly retryInMs?: number;
	readonly close?: TransportCloseEvent;
}

export interface FrameEvent {
	readonly type: 'frame';
	readonly at: number;
	readonly direction: MessageDirection;
	readonly messageType: 'CALL' | 'CALLRESULT' | 'CALLERROR';
	readonly action?: string;
	readonly messageId: string;
	readonly frame: OcppFrame;
	readonly text: string;
}

export interface LogEvent {
	readonly type: 'log';
	readonly at: number;
	readonly entry: SimulatorLogEntry;
}

export interface PendingEvent {
	readonly type: 'pending';
	readonly at: number;
	readonly phase: 'added' | 'resolved' | 'rejected' | 'timeout' | 'cancelled';
	readonly messageId: string;
	readonly action: string;
	readonly rttMs?: number;
	readonly error?: SimulatorErrorSnapshot;
}

export interface QueueEvent {
	readonly type: 'queue';
	readonly at: number;
	readonly phase: 'enqueued' | 'replayed' | 'flushed' | 'cleared' | 'overflow' | 'restored';
	readonly size: number;
	readonly frame?: CallFrame;
}

export interface BootEvent {
	readonly type: 'boot';
	readonly at: number;
	readonly status: 'not-booted' | 'pending' | 'accepted' | 'rejected' | 'error';
	readonly intervalMs?: number;
	readonly error?: SimulatorErrorSnapshot;
}

export interface HeartbeatEvent {
	readonly type: 'heartbeat';
	readonly at: number;
	readonly intervalMs: number;
	readonly driftMs?: number;
}

export interface ConnectorEvent {
	readonly type: 'connector';
	readonly at: number;
	readonly connectorId: number;
	readonly status: string;
	readonly meterWh?: number;
}

export interface EvseEvent {
	readonly type: 'evse';
	readonly at: number;
	readonly evseId: number;
	readonly status: string;
	readonly meterWh?: number;
}

export interface TransactionEvent {
	readonly type: 'transaction';
	readonly at: number;
	readonly phase: 'started' | 'updated' | 'stopped';
	readonly protocol: OcppVersion;
	readonly entityId: number;
	readonly transactionId: string | number;
}

export interface ReservationEvent {
	readonly type: 'reservation';
	readonly at: number;
	readonly phase: 'created' | 'cancelled' | 'expired';
	readonly connectorId?: number;
	readonly evseId?: number;
	readonly reservationId: number;
}

export interface MetricsEvent {
	readonly type: 'metrics';
	readonly at: number;
	readonly errorCountLastMinute: number;
}

export interface NoticeEvent {
	readonly type: 'notice';
	readonly at: number;
	readonly level: NoticeLevel;
	readonly message: string;
	readonly code?: string;
}

export interface FaultEvent {
	readonly type: 'fault';
	readonly at: number;
	readonly kind: 'latency' | 'drop' | 'malform';
	readonly action: string;
	readonly messageId?: string;
}

export interface ValidationEvent {
	readonly type: 'validation';
	readonly at: number;
	readonly mode: ValidateMode;
	readonly action: string;
	readonly errors: readonly string[];
	readonly blocked: boolean;
}

export interface ScenarioEvent {
	readonly type: 'scenario';
	readonly at: number;
	readonly phase: 'started' | 'step' | 'completed' | 'failed' | 'cancelled';
	readonly step?: number;
	readonly error?: SimulatorErrorSnapshot;
}

export interface ErrorEvent {
	readonly type: 'error';
	readonly at: number;
	readonly error: SimulatorErrorSnapshot;
	readonly fatal: boolean;
	/** False when the error only adds context to an already-counted failure. */
	readonly countsAsError?: boolean;
}

export type SimulatorEvent =
	| ConnectionEvent
	| FrameEvent
	| LogEvent
	| PendingEvent
	| QueueEvent
	| BootEvent
	| HeartbeatEvent
	| ConnectorEvent
	| EvseEvent
	| TransactionEvent
	| ReservationEvent
	| MetricsEvent
	| NoticeEvent
	| FaultEvent
	| ValidationEvent
	| ScenarioEvent
	| ErrorEvent;

export type EventListener<K extends SimulatorEvent['type']> = (
	event: Extract<SimulatorEvent, { type: K }>,
) => void | Promise<void>;

export type Unsubscribe = () => void;

/**
 * A small typed event emitter. Listener exceptions are isolated: a listener
 * cannot stop the promise settlement or another listener. Async rejections from
 * non-error listeners are reported as errors; failures inside error listeners
 * are ignored to avoid an infinite report loop.
 */
export class EventEmitter {
	private readonly listeners = new Map<
		string,
		Set<(event: SimulatorEvent) => void | Promise<void>>
	>();
	private readonly anyListeners = new Set<(event: SimulatorEvent) => void | Promise<void>>();
	private readonly now: () => number;
	private disposed = false;
	private reporting = false;

	constructor(now: () => number) {
		this.now = now;
	}

	on<K extends SimulatorEvent['type']>(type: K, listener: EventListener<K>): Unsubscribe {
		const set =
			this.listeners.get(type) ?? new Set<(event: SimulatorEvent) => void | Promise<void>>();
		set.add(listener as (event: SimulatorEvent) => void | Promise<void>);
		this.listeners.set(type, set);
		return () => {
			set.delete(listener as (event: SimulatorEvent) => void | Promise<void>);
		};
	}

	onAny(listener: (event: SimulatorEvent) => void | Promise<void>): Unsubscribe {
		this.anyListeners.add(listener);
		return () => {
			this.anyListeners.delete(listener);
		};
	}

	emit(event: SimulatorEvent): void {
		if (this.disposed) {
			return;
		}
		const typed = this.listeners.get(event.type);
		const listeners = [...(typed ?? []), ...this.anyListeners];
		const reportListenerError = (error: unknown): void => {
			// Reporting a failing error listener would recurse forever.
			if (event.type !== 'error') {
				this.report(error);
			}
		};
		for (const listener of listeners) {
			try {
				const result = listener(event) as unknown;
				if (isThenable(result)) {
					void Promise.resolve(result).catch(reportListenerError);
				}
			} catch (error) {
				reportListenerError(error);
			}
		}
	}

	clear(): void {
		this.listeners.clear();
		this.anyListeners.clear();
	}

	dispose(): void {
		this.disposed = true;
		this.clear();
	}

	private report(error: unknown): void {
		if (this.reporting) {
			return;
		}
		this.reporting = true;
		try {
			this.emit({
				type: 'error',
				at: this.now(),
				error: errorSnapshot(error),
				fatal: false,
			});
		} finally {
			this.reporting = false;
		}
	}
}

function isThenable(value: unknown): value is PromiseLike<unknown> {
	return (
		typeof value === 'object' &&
		value !== null &&
		typeof (value as { then?: unknown }).then === 'function'
	);
}
