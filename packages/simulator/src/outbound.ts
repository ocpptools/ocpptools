// SPDX-License-Identifier: Apache-2.0
// SPDX-FileCopyrightText: 2026 Rodolfo Carrillo

import type { OcppFrame } from '@ocpptools/core';

import type { Scheduler } from './clock.js';
import type { EventEmitter } from './events.js';
import type { History, LogMessageType } from './log.js';
import type { RandomSource } from './random.js';
import type { FaultConfig } from './state.js';

export type OutboundKind = 'CALL' | 'CALLRESULT' | 'CALLERROR' | 'RAW';

export interface OutboundInput {
	readonly text: string;
	readonly frame?: OcppFrame;
	readonly kind: OutboundKind;
	readonly action?: string;
	readonly messageId?: string;
	readonly isCancelled?: () => boolean;
}

export interface OutboundDelivery {
	readonly delivered: boolean;
	readonly text: string;
	readonly malformed: boolean;
	readonly cancelled: boolean;
}

export interface OutboundPipelineOptions {
	readonly scheduler: Scheduler;
	readonly events: EventEmitter;
	readonly history: History;
	readonly random: RandomSource;
	readonly getFaults: () => FaultConfig;
	readonly getEpoch: () => number;
	readonly isOpen: () => boolean;
	readonly sendText: (text: string) => void;
}

/**
 * Applies the lab faults to one outbound frame in the documented order:
 * drop, then malformed payload, then latency. The pipeline never retries and
 * never requeues; the caller decides what a non-delivered frame means.
 */
export class OutboundPipeline {
	private readonly options: OutboundPipelineOptions;
	private readonly pendingDelays = new Set<() => void>();

	constructor(options: OutboundPipelineOptions) {
		this.options = options;
	}

	/** Cancels every in-flight latency delay without sending. */
	cancelAll(): void {
		for (const cancel of [...this.pendingDelays]) {
			cancel();
		}
		this.pendingDelays.clear();
	}

	async deliver(input: OutboundInput): Promise<OutboundDelivery> {
		const epoch = this.options.getEpoch();
		const faults = this.options.getFaults();
		const action = input.action ?? input.kind;
		if (faults.dropRate > 0 && this.options.random() < faults.dropRate) {
			this.fault('drop', action, input.messageId);
			this.record(input, 'DROP', input.text, 'warning', { rate: faults.dropRate });
			return { delivered: false, text: input.text, malformed: false, cancelled: false };
		}

		let text = input.text;
		let malformed = false;
		if (faults.malformRate > 0 && this.options.random() < faults.malformRate) {
			malformed = true;
			text = malformedText(input.text);
			this.fault('malform', action, input.messageId);
			this.record(input, 'MALFORMED', text, 'warning', { rate: faults.malformRate });
		}

		if (faults.latencyMs > 0) {
			this.fault('latency', action, input.messageId);
			this.record(input, 'LATENCY', text, 'info', { delayMs: faults.latencyMs });
			const elapsed = await this.delay(faults.latencyMs);
			if (
				!elapsed ||
				epoch !== this.options.getEpoch() ||
				!this.options.isOpen() ||
				input.isCancelled?.() === true
			) {
				return { delivered: false, text, malformed, cancelled: true };
			}
		}

		if (
			epoch !== this.options.getEpoch() ||
			!this.options.isOpen() ||
			input.isCancelled?.() === true
		) {
			return { delivered: false, text, malformed, cancelled: true };
		}
		this.options.sendText(text);
		return { delivered: true, text, malformed, cancelled: false };
	}

	private delay(delayMs: number): Promise<boolean> {
		return new Promise<boolean>((resolve) => {
			let settled = false;
			const cancelDelay: () => void = () => {
				if (settled) return;
				settled = true;
				this.pendingDelays.delete(cancelDelay);
				cancelTimer();
				resolve(false);
			};
			const cancelTimer = this.options.scheduler.setTimeout(() => {
				if (settled) return;
				settled = true;
				this.pendingDelays.delete(cancelDelay);
				resolve(true);
			}, delayMs);
			this.pendingDelays.add(cancelDelay);
		});
	}

	private fault(
		kind: 'latency' | 'drop' | 'malform',
		action: string,
		messageId: string | undefined,
	): void {
		this.options.events.emit({
			type: 'fault',
			at: this.options.scheduler.now(),
			kind,
			action,
			...(messageId === undefined ? {} : { messageId }),
		});
	}

	private record(
		input: OutboundInput,
		tag: 'DROP' | 'MALFORMED' | 'LATENCY',
		text: string,
		level: 'info' | 'warning',
		data: Record<string, unknown>,
	): void {
		const at = this.options.scheduler.now();
		const action = input.action ?? input.kind;
		const messageType: LogMessageType = input.kind === 'RAW' ? 'SYSTEM' : input.kind;
		const entry = {
			at,
			direction: 'sent' as const,
			messageType,
			action: `[${tag}] ${action}`,
			...(input.messageId === undefined ? {} : { messageId: input.messageId }),
			text: text.slice(0, 200),
			level,
			code: `fault-${tag.toLowerCase()}`,
			data,
		};
		this.options.history.add(entry);
		this.options.events.emit({ type: 'log', at, entry });
	}
}

function malformedText(text: string): string {
	const trimmed = text.trimEnd();
	if (trimmed.length === 0) return '{';
	return trimmed.slice(0, -1);
}
