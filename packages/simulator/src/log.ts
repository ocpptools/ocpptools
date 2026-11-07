// SPDX-License-Identifier: Apache-2.0
// SPDX-FileCopyrightText: 2026 Rodolfo Carrillo

import type { OcppFrame } from '@ocpptools/core';

export type LogDirection = 'sent' | 'received' | 'system';
export type LogMessageType = 'CALL' | 'CALLRESULT' | 'CALLERROR' | 'SYSTEM';
export type LogLevel = 'info' | 'warning' | 'error';

/** One entry in the bounded protocol history. */
export interface SimulatorLogEntry {
	readonly at: number;
	readonly direction: LogDirection;
	readonly messageType: LogMessageType;
	readonly action: string;
	readonly messageId?: string;
	readonly frame?: OcppFrame;
	readonly text?: string;
	readonly level?: LogLevel;
	readonly code?: string;
	readonly data?: unknown;
}

/** A newest-first, bounded history. */
export class History {
	private entries: SimulatorLogEntry[] = [];
	private maxEntries: number;

	constructor(maxEntries = 500) {
		this.maxEntries = normalizeBound(maxEntries);
	}

	add(entry: SimulatorLogEntry): void {
		this.entries.unshift(entry);
		if (this.entries.length > this.maxEntries) {
			this.entries.length = this.maxEntries;
		}
	}

	get(): readonly SimulatorLogEntry[] {
		return this.entries.slice();
	}

	clear(): void {
		this.entries = [];
	}

	setMaxEntries(maxEntries: number): void {
		this.maxEntries = normalizeBound(maxEntries);
		if (this.entries.length > this.maxEntries) {
			this.entries.length = this.maxEntries;
		}
	}
}

function normalizeBound(value: number): number {
	if (!Number.isFinite(value)) {
		return 500;
	}
	return Math.max(1, Math.floor(value));
}
