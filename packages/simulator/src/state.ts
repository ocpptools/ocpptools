// SPDX-License-Identifier: Apache-2.0
// SPDX-FileCopyrightText: 2026 Rodolfo Carrillo

import type {
	CallFrame,
	Clock,
	MessageIdGenerator,
	OcppVersion,
	Storage,
	TransportFactory,
} from '@ocpptools/core';

import type { ConnectionSnapshot, ReconnectOptions } from './connection.js';
import type { InboundResponseMode, ValidateMode } from './events.js';
import type { SimulatorMetrics } from './metrics.js';
import type { RandomSource } from './random.js';

export type BootStatus = 'not-booted' | 'pending' | 'accepted' | 'rejected' | 'error';

export interface BootSnapshot {
	readonly status: BootStatus;
	readonly intervalMs?: number;
	readonly lastResponse?: Record<string, unknown>;
	readonly lastError?: string;
}

export interface FaultConfig {
	readonly latencyMs: number;
	readonly dropRate: number;
	readonly malformRate: number;
}

export interface SimulatorStateBase {
	readonly version: OcppVersion;
	readonly connection: ConnectionSnapshot;
	readonly boot: BootSnapshot;
	readonly queueSize: number;
	readonly metrics: SimulatorMetrics;
	readonly clockOffsetMs: number;
	readonly faults: FaultConfig;
	readonly validationMode: ValidateMode;
	readonly inboundResponseMode: InboundResponseMode;
}

export interface BootOptions {
	readonly auto?: boolean;
	readonly required?: boolean;
	readonly retryOnPending?: boolean;
	readonly retryIntervalMs?: number;
}

export interface TimingOptions {
	readonly pendingCallTimeoutMs?: number;
	readonly heartbeatIntervalMs?: number;
	readonly meterValueIntervalMs?: number;
}

export interface PersistenceOptions {
	readonly storage: Storage;
	readonly key: string;
	readonly autoSave?: boolean;
	readonly saveDebounceMs?: number;
	readonly includeHistory?: boolean;
}

export interface CommonSimulatorOptions {
	readonly url: string;
	readonly transport: TransportFactory;
	readonly clock: Clock;
	readonly random?: RandomSource;
	readonly messageIds?: MessageIdGenerator;
	readonly boot?: BootOptions;
	readonly timing?: TimingOptions;
	readonly reconnect?: ReconnectOptions;
	readonly queue?: { readonly maxEntries?: number; readonly flushOn?: 'open' | 'boot-accepted' };
	readonly history?: { readonly maxEntries?: number };
	readonly validation?: {
		readonly mode?: ValidateMode;
		readonly validateOutbound?: (
			frame: CallFrame,
		) => readonly string[] | null | Promise<readonly string[] | null>;
	};
	readonly faults?: Partial<FaultConfig>;
	readonly inbound?: { readonly policy?: InboundResponseMode };
	readonly persistence?: PersistenceOptions;
}

/** A stable, serializable view of the resolved simulator configuration. */
export interface SimulatorConfig {
	readonly version: OcppVersion;
	readonly url: string;
	readonly boot: Required<BootOptions>;
	readonly queue: { readonly maxEntries: number };
	readonly heartbeatIntervalMs: number;
	readonly meterValueIntervalMs: number;
	readonly ready: boolean;
}
