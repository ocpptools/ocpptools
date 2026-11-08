// SPDX-License-Identifier: Apache-2.0
// SPDX-FileCopyrightText: 2026 Rodolfo Carrillo

import {
	MESSAGE_TYPE,
	parseFrame,
	type CallFrame,
	type JsonObject,
	type MessageId,
} from '@ocpptools/core';

import { SimulatorError } from './errors.js';
import { writeFrame } from './frames.js';

export interface QueuedCall {
	readonly action: string;
	readonly payload: JsonObject;
	readonly messageId: MessageId;
	readonly enqueuedAt: number;
	readonly frame: CallFrame;
	readonly text: string;
}

export interface QueueOptions {
	readonly maxEntries?: number;
	readonly now: () => number;
}

export interface QueueSnapshot {
	readonly version: 1;
	readonly entries: readonly string[];
}

export interface FlushResult {
	readonly sent: number;
	readonly remaining: number;
	readonly stoppedBy?: 'send-failed' | 'changed';
	readonly error?: unknown;
}

/**
 * A bounded FIFO of outbound CALL frames. Entries are canonicalized at enqueue
 * time; a caller cannot mutate a queued frame after it is stored.
 */
export class OfflineQueue {
	private readonly maxEntries: number;
	private readonly now: () => number;
	private items: QueuedCall[] = [];
	private externalRevision = 0;
	private flushing: Promise<FlushResult> | null = null;

	constructor(options: QueueOptions) {
		const maxEntries = options.maxEntries ?? 500;
		if (!Number.isInteger(maxEntries) || maxEntries < 1) {
			throw new SimulatorError('invalid-options', 'maxEntries must be a positive integer');
		}
		this.maxEntries = maxEntries;
		this.now = options.now;
	}

	get size(): number {
		return this.items.length;
	}

	get isFlushing(): boolean {
		return this.flushing !== null;
	}

	enqueue(action: string, payload: JsonObject, messageId: MessageId): QueuedCall | undefined {
		if (action === 'BootNotification' || action === 'Heartbeat') {
			throw new SimulatorError('invalid-options', `${action} must not enter the offline queue`);
		}
		if (typeof messageId !== 'string' || messageId === '' || messageId.length > 36) {
			throw new SimulatorError('invalid-options', 'The queued message ID is invalid');
		}
		if (this.items.some((entry) => entry.messageId === messageId)) {
			throw new SimulatorError('duplicate-message-id', 'The queue already has that message ID');
		}
		const frame: CallFrame = [MESSAGE_TYPE.CALL, messageId, action, payload];
		const text = writeFrame(frame);
		const parsed = parseFrame(text);
		if (!parsed.ok || parsed.value[0] !== MESSAGE_TYPE.CALL) {
			throw new SimulatorError('invalid-frame', 'The frame could not be queued');
		}
		const canonical = parsed.value;
		const entry: QueuedCall = {
			action: canonical[2],
			payload: canonical[3],
			messageId: canonical[1],
			enqueuedAt: this.now(),
			frame: canonical,
			text,
		};
		const dropped = this.items.length >= this.maxEntries ? this.items.shift() : undefined;
		this.items.push(entry);
		this.externalRevision += 1;
		return dropped;
	}

	get(): readonly QueuedCall[] {
		return this.items.map((entry) => cloneEntry(entry));
	}

	clear(): void {
		this.items = [];
		this.externalRevision += 1;
	}

	/**
	 * Drains the queue in order. The `send` callback must not await `flush`
	 * again: the active single-flight promise would wait on the callback.
	 */
	async flush(send: (text: string) => Promise<void>): Promise<FlushResult> {
		if (this.flushing !== null) {
			return this.flushing;
		}
		const revision = this.externalRevision;
		// Install the single-flight promise before the first send, so a flush
		// reentered from inside send() sees the active drain.
		const flushing = Promise.resolve().then(() => this.runFlush(send, revision));
		this.flushing = flushing;
		void flushing.then(
			() => {
				if (this.flushing === flushing) {
					this.flushing = null;
				}
			},
			() => {
				if (this.flushing === flushing) {
					this.flushing = null;
				}
			},
		);
		return flushing;
	}

	private async runFlush(
		send: (text: string) => Promise<void>,
		revision: number,
	): Promise<FlushResult> {
		let sent = 0;
		if (this.externalRevision !== revision) {
			return { sent, remaining: this.items.length, stoppedBy: 'changed' };
		}
		while (this.items.length > 0) {
			if (this.externalRevision !== revision) {
				return { sent, remaining: this.items.length, stoppedBy: 'changed' };
			}
			const head = this.items[0];
			if (head === undefined) {
				break;
			}
			try {
				await send(head.text);
			} catch (error) {
				return { sent, remaining: this.items.length, stoppedBy: 'send-failed', error };
			}
			if (this.items[0] !== head) {
				return { sent, remaining: this.items.length, stoppedBy: 'changed' };
			}
			this.items.shift();
			sent += 1;
			if (this.externalRevision !== revision) {
				return { sent, remaining: this.items.length, stoppedBy: 'changed' };
			}
		}
		return { sent, remaining: 0 };
	}

	/**
	 * Represents the queue as canonical text. `enqueuedAt` is not part of the
	 * snapshot and is recreated by `restore`.
	 */
	snapshot(): QueueSnapshot {
		return { version: 1, entries: this.items.map((entry) => entry.text) };
	}

	restore(snapshot: unknown): void {
		if (!isSnapshot(snapshot)) {
			throw new SimulatorError('invalid-snapshot', 'The offline queue snapshot is invalid');
		}
		if (snapshot.entries.length > this.maxEntries) {
			throw new SimulatorError('invalid-snapshot', 'The offline queue snapshot is too large');
		}
		if (!snapshot.entries.every((entry) => typeof entry === 'string')) {
			throw new SimulatorError(
				'invalid-snapshot',
				'The offline queue snapshot has non-text entries',
			);
		}
		const seen = new Set<MessageId>();
		const restored: QueuedCall[] = [];
		for (const text of snapshot.entries) {
			const parsed = parseFrame(text);
			if (!parsed.ok || parsed.value[0] !== MESSAGE_TYPE.CALL) {
				throw new SimulatorError('invalid-snapshot', 'The queue contains a non-CALL frame');
			}
			const frame = parsed.value;
			const action = frame[2];
			const messageId = frame[1];
			if (action === 'BootNotification' || action === 'Heartbeat') {
				throw new SimulatorError('invalid-snapshot', `${action} must not be restored`);
			}
			if (messageId.length > 36) {
				throw new SimulatorError('invalid-snapshot', 'The message ID is too long');
			}
			if (seen.has(messageId)) {
				throw new SimulatorError('invalid-snapshot', 'The queue contains duplicate message IDs');
			}
			seen.add(messageId);
			const canonicalText = writeFrame(frame);
			restored.push({
				action,
				payload: frame[3],
				messageId,
				enqueuedAt: this.now(),
				frame,
				text: canonicalText,
			});
		}
		this.items = restored;
		this.externalRevision += 1;
	}
}

function isSnapshot(value: unknown): value is QueueSnapshot {
	if (typeof value !== 'object' || value === null) {
		return false;
	}
	const candidate = value as { version?: unknown; entries?: unknown };
	return candidate.version === 1 && Array.isArray(candidate.entries);
}

function cloneEntry(entry: QueuedCall): QueuedCall {
	const parsed = parseFrame(entry.text);
	if (!parsed.ok || parsed.value[0] !== MESSAGE_TYPE.CALL) {
		return entry;
	}
	return {
		...entry,
		payload: parsed.value[3],
		frame: parsed.value,
	};
}
