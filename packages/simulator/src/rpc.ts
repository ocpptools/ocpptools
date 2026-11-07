// SPDX-License-Identifier: Apache-2.0
// SPDX-FileCopyrightText: 2026 Rodolfo Carrillo

import {
	MESSAGE_TYPE,
	OCPP_VERSIONS,
	inspectFrame,
	isErrorCode,
	type CallErrorFrame,
	type CallFrame,
	type CallResultFrame,
	type JsonObject,
	type MessageId,
	type MessageIdGenerator,
	type OcppFrame,
	type OcppVersion,
} from '@ocpptools/core';

import type { Scheduler } from './clock.js';
import { SimulatorCallError, SimulatorError, errorSnapshot } from './errors.js';
import type { EventEmitter } from './events.js';
import {
	frameAction,
	frameMessageId,
	messageTypeName,
	readInboundFrame,
	writeFrame,
	type InboundFrameFailure,
} from './frames.js';
import type { History } from './log.js';

export interface PendingCall {
	readonly messageId: MessageId;
	readonly action: string;
	readonly createdAt: number;
	readonly expiresAt?: number;
}

export interface CallContext {
	readonly messageId: MessageId;
	readonly action: string;
	readonly payload: JsonObject;
	readonly version: OcppVersion;
	reply(payload: JsonObject): Promise<boolean>;
	fail(errorCode: string, description: string, details?: JsonObject): Promise<boolean>;
	sendCall(action: string, payload: JsonObject): Promise<JsonObject>;
}

export type CallHandler = (context: CallContext) => void | Promise<void>;

export interface RpcOptions {
	readonly version: OcppVersion;
	readonly scheduler: Scheduler;
	readonly events: EventEmitter;
	readonly history: History;
	readonly messageIds: MessageIdGenerator;
	readonly sendText: (text: string) => Promise<void>;
	readonly isOpen: () => boolean;
	readonly timeoutMs?: number;
}

type PendingState = 'preparing' | 'sending' | 'sent';

interface PendingEntry {
	readonly messageId: MessageId;
	readonly action: string;
	readonly frame: CallFrame;
	readonly text: string;
	readonly createdAt: number;
	readonly resolve: (payload: JsonObject) => void;
	readonly reject: (error: SimulatorError) => void;
	state: PendingState;
	settled: boolean;
	expiresAt?: number;
	cancelTimeout?: () => void;
	epoch: number;
}

interface InboundEntry {
	readonly messageId: MessageId;
	readonly action: string;
	readonly epoch: number;
	replied: boolean;
}

/**
 * The OCPP-J RPC framework. One instance belongs to one connection epoch; the
 * connection layer calls reset() before a new transport is attached.
 */
export class Rpc {
	private readonly options: RpcOptions;
	private readonly pending = new Map<MessageId, PendingEntry>();
	private readonly inboundCalls = new Map<MessageId, InboundEntry>();
	private readonly recentlyReplied = new Set<MessageId>();
	private readonly handlers = new Map<string, CallHandler>();
	private readonly timeoutMs: number;
	private epoch = 0;
	private disposed = false;

	constructor(options: RpcOptions) {
		if (!(OCPP_VERSIONS as readonly string[]).includes(options.version)) {
			throw new SimulatorError('invalid-options', `Unsupported OCPP version: ${options.version}`);
		}
		this.options = options;
		this.timeoutMs = validateTimeout(options.timeoutMs ?? 15_000);
	}

	get version(): OcppVersion {
		return this.options.version;
	}

	get currentEpoch(): number {
		return this.epoch;
	}

	onCall(action: string, handler: CallHandler): () => void {
		this.handlers.set(action, handler);
		return () => {
			if (this.handlers.get(action) === handler) {
				this.handlers.delete(action);
			}
		};
	}

	sendCall(action: string, payload: JsonObject): Promise<JsonObject> {
		try {
			this.assertActive();
			if (!this.options.isOpen()) {
				throw new SimulatorError('not-connected', 'The transport is not open');
			}
			const messageId = this.nextMessageId();
			const frame: CallFrame = [MESSAGE_TYPE.CALL, messageId, action, payload];
			const text = writeFrame(frame);

			const promise = new Promise<JsonObject>((resolve, reject) => {
				const entry: PendingEntry = {
					messageId,
					action,
					frame,
					text,
					createdAt: this.options.scheduler.now(),
					resolve,
					reject,
					state: 'preparing',
					settled: false,
					epoch: this.epoch,
				};
				this.pending.set(messageId, entry);
				this.emitPending('added', entry);
				if (entry.settled || entry.epoch !== this.epoch || this.disposed) {
					return;
				}
				void this.transmit(entry).catch((error: unknown) => {
					if (!entry.settled) {
						this.settleReject(
							entry,
							new SimulatorError('internal-error', 'The call could not be prepared', {
								cause: error,
							}),
							'rejected',
						);
					}
					this.report(error);
				});
			});
			// Mark the caller-visible promise as handled even when nobody awaits it;
			// the original rejection still reaches an await or a catch.
			void promise.catch(() => undefined);
			return promise;
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

	async sendCallResult(messageId: MessageId, payload: JsonObject): Promise<boolean> {
		this.assertActive();
		if (this.recentlyReplied.has(messageId)) {
			this.report(
				new SimulatorError('invalid-response', `CALLRESULT for ${messageId} was already sent`),
			);
			return false;
		}
		const inbound = this.inboundCalls.get(messageId);
		if (inbound !== undefined) {
			return this.reply(inbound, payload);
		}
		const frame: CallResultFrame = [MESSAGE_TYPE.CALLRESULT, messageId, payload];
		await this.sendFrame(frame);
		this.rememberReplied(messageId);
		return true;
	}

	async sendCallError(
		messageId: MessageId,
		errorCode: string,
		errorDescription: string,
		errorDetails: JsonObject = {},
	): Promise<boolean> {
		this.assertActive();
		if (!isErrorCode(this.version, errorCode)) {
			throw new SimulatorError(
				'invalid-error-code',
				`${errorCode} is not an OCPP ${this.version} error code`,
			);
		}
		if (this.recentlyReplied.has(messageId)) {
			this.report(
				new SimulatorError('invalid-response', `CALLERROR for ${messageId} was already sent`),
			);
			return false;
		}
		const inbound = this.inboundCalls.get(messageId);
		if (inbound !== undefined) {
			return this.fail(inbound, errorCode, errorDescription, errorDetails);
		}
		await this.sendErrorRaw(messageId, errorCode, errorDescription, errorDetails);
		this.rememberReplied(messageId);
		return true;
	}

	async sendRawFrame(frame: readonly unknown[]): Promise<void> {
		this.assertActive();
		if (!Array.isArray(frame) || frame.length === 0) {
			throw new SimulatorError('invalid-frame', 'A raw frame must be a non-empty array');
		}
		let text: string;
		try {
			text = JSON.stringify(frame);
		} catch (error) {
			throw new SimulatorError('invalid-frame', 'The raw frame cannot be serialized', {
				cause: error,
			});
		}
		this.assertActive();
		if (!this.options.isOpen()) {
			throw new SimulatorError('not-connected', 'The transport is not open');
		}
		await this.options.sendText(text);
		const inspection = inspectFrame(frame);
		const hasErrors = inspection.issues.some((issue) => issue.severity === 'error');
		if (!hasErrors && inspection.messageType !== undefined) {
			this.emitFrame('sent', frame as unknown as OcppFrame, text);
		} else {
			this.system('warning', 'Raw frame sent', { text: text.slice(0, 200) });
		}
	}

	async sendText(text: string): Promise<void> {
		this.assertActive();
		if (!this.options.isOpen()) {
			throw new SimulatorError('not-connected', 'The transport is not open');
		}
		await this.options.sendText(text);
		this.system('info', 'Raw text sent', { text: text.slice(0, 200) });
	}

	/** Handles one text frame received from the peer. */
	handleText(text: string): void {
		if (this.disposed) {
			return;
		}
		const epoch = this.epoch;
		const inbound = readInboundFrame(text);
		if (!inbound.ok) {
			this.handleMalformed(inbound, epoch);
			return;
		}

		const frame = inbound.frame;
		this.emitFrame('received', frame, text);
		if (epoch !== this.epoch) {
			return;
		}
		if (frame[0] === MESSAGE_TYPE.CALL) {
			this.dispatchCall(frame, text, epoch);
			return;
		}
		if (frame[0] === MESSAGE_TYPE.CALLRESULT) {
			this.resolveResult(frame, epoch);
			return;
		}
		this.rejectCallError(frame, epoch);
	}

	/** Cancels the current connection epoch. Handlers stay registered. */
	reset(reason: 'disconnected' | 'disposed' = 'disconnected'): void {
		this.epoch += 1;
		for (const entry of [...this.pending.values()]) {
			this.settleReject(
				entry,
				new SimulatorError(
					reason,
					reason === 'disposed' ? 'The simulator is disposed' : 'The connection closed',
				),
				'cancelled',
			);
		}
		for (const entry of [...this.inboundCalls.values()]) {
			if (this.inboundCalls.get(entry.messageId) === entry) {
				this.inboundCalls.delete(entry.messageId);
			}
		}
	}

	dispose(): void {
		if (this.disposed) {
			return;
		}
		this.disposed = true;
		this.reset('disposed');
		this.handlers.clear();
	}

	getPending(): readonly PendingCall[] {
		return [...this.pending.values()]
			.map((entry) => ({
				messageId: entry.messageId,
				action: entry.action,
				createdAt: entry.createdAt,
				...(entry.expiresAt === undefined ? {} : { expiresAt: entry.expiresAt }),
			}))
			.sort((left, right) => left.createdAt - right.createdAt);
	}

	cancelAll(reason: string): void {
		for (const entry of [...this.pending.values()]) {
			this.settleReject(entry, new SimulatorError('disconnected', reason), 'cancelled');
		}
	}

	private async transmit(entry: PendingEntry): Promise<void> {
		if (entry.settled || entry.epoch !== this.epoch || this.disposed) {
			return;
		}
		entry.state = 'sending';
		try {
			await this.options.sendText(entry.text);
		} catch (error) {
			if (!entry.settled && entry.epoch === this.epoch) {
				this.settleReject(
					entry,
					new SimulatorError('send-failed', `Could not send ${entry.action}`, {
						cause: error,
					}),
					'rejected',
				);
			}
			return;
		}

		// The frame reached the transport. Record it even when a loopback
		// transport delivered the response before sendText resolved.
		this.emitFrame('sent', entry.frame, entry.text);
		if (entry.settled || entry.epoch !== this.epoch || this.disposed) {
			return;
		}
		entry.state = 'sent';
		if (this.timeoutMs > 0) {
			try {
				entry.expiresAt = this.options.scheduler.now() + this.timeoutMs;
				entry.cancelTimeout = this.options.scheduler.setTimeout(() => {
					if (!entry.settled) {
						this.settleReject(
							entry,
							new SimulatorError('timeout', `Timeout waiting ${entry.action}.conf`),
							'timeout',
						);
					}
				}, this.timeoutMs);
			} catch (error) {
				this.settleReject(
					entry,
					new SimulatorError('internal-error', 'Could not schedule the call timeout', {
						cause: error,
					}),
					'rejected',
				);
			}
		}
	}

	private dispatchCall(frame: CallFrame, text: string, epoch: number): void {
		if (epoch !== this.epoch || this.disposed) {
			return;
		}
		const messageId = frameMessageId(frame);
		const action = frame[2];
		const payload = frame[3];

		if (this.inboundCalls.has(messageId)) {
			void this.sendErrorRaw(
				messageId,
				'ProtocolError',
				`A call with message ID ${messageId} is already active`,
			).catch((error: unknown) => this.report(error));
			return;
		}

		const entry: InboundEntry = { messageId, action, epoch, replied: false };
		this.inboundCalls.set(messageId, entry);
		const handler = this.handlers.get(action);
		if (handler === undefined) {
			this.inboundCalls.delete(messageId);
			void this.sendErrorRaw(
				messageId,
				'NotImplemented',
				`Action ${action} is not implemented by this simulator`,
			).catch((error: unknown) => this.report(error));
			return;
		}

		const context: CallContext = {
			messageId,
			action,
			payload,
			version: this.version,
			reply: (result) => this.reply(entry, result),
			fail: (errorCode, description, details) => this.fail(entry, errorCode, description, details),
			sendCall: (nextAction, nextPayload) => this.sendCall(nextAction, nextPayload),
		};

		Promise.resolve()
			.then(() => handler(context))
			.then(() => {
				if (entry.epoch !== this.epoch) {
					return;
				}
				if (!entry.replied && this.inboundCalls.get(messageId) === entry) {
					this.inboundCalls.delete(messageId);
					this.report(
						new SimulatorError(
							'invalid-response',
							`Handler for ${action} resolved without replying`,
						),
					);
					if (entry.epoch === this.epoch) {
						void this.sendErrorRaw(
							messageId,
							'InternalError',
							`Handler for ${action} did not reply`,
						).catch((error: unknown) => this.report(error));
					}
				}
			})
			.catch((error: unknown) => {
				if (entry.replied || this.inboundCalls.get(messageId) !== entry) {
					this.report(error);
					return;
				}
				this.inboundCalls.delete(messageId);
				this.report(error);
				if (entry.epoch === this.epoch) {
					void this.sendErrorRaw(messageId, 'InternalError', 'Inbound handler failed').catch(
						(replyError: unknown) => this.report(replyError),
					);
				}
			});

		void text;
	}

	private async reply(entry: InboundEntry, payload: JsonObject): Promise<boolean> {
		if (entry.replied) {
			this.report(new SimulatorError('invalid-response', `Second reply for ${entry.action}`));
			return false;
		}
		if (this.inboundCalls.get(entry.messageId) !== entry) {
			this.report(
				new SimulatorError('disconnected', `Reply for ${entry.action} dropped after reset`),
			);
			return false;
		}
		let text: string;
		try {
			text = writeFrame([MESSAGE_TYPE.CALLRESULT, entry.messageId, payload]);
		} catch (error) {
			this.report(error);
			return false;
		}
		entry.replied = true;
		this.rememberReplied(entry.messageId);
		this.inboundCalls.delete(entry.messageId);
		if (entry.epoch !== this.epoch || !this.options.isOpen()) {
			this.report(
				new SimulatorError('disconnected', `Reply for ${entry.action} dropped after reconnect`),
			);
			return false;
		}
		try {
			await this.options.sendText(text);
			this.emitFrame('sent', [MESSAGE_TYPE.CALLRESULT, entry.messageId, payload], text);
			return true;
		} catch (error) {
			this.report(error);
			return false;
		}
	}

	private async fail(
		entry: InboundEntry,
		errorCode: string,
		description: string,
		details: JsonObject = {},
	): Promise<boolean> {
		if (entry.replied) {
			this.report(new SimulatorError('invalid-response', `Second reply for ${entry.action}`));
			return false;
		}
		if (this.inboundCalls.get(entry.messageId) !== entry) {
			this.report(
				new SimulatorError('disconnected', `Reply for ${entry.action} dropped after reset`),
			);
			return false;
		}
		if (!isErrorCode(this.version, errorCode)) {
			this.report(
				new SimulatorError(
					'invalid-error-code',
					`${errorCode} is not an OCPP ${this.version} error code`,
				),
			);
			return false;
		}
		let text: string;
		try {
			text = writeFrame([MESSAGE_TYPE.CALLERROR, entry.messageId, errorCode, description, details]);
		} catch (error) {
			this.report(error);
			return false;
		}
		entry.replied = true;
		this.rememberReplied(entry.messageId);
		this.inboundCalls.delete(entry.messageId);
		if (entry.epoch !== this.epoch || !this.options.isOpen()) {
			this.report(
				new SimulatorError('disconnected', `Reply for ${entry.action} dropped after reconnect`),
			);
			return false;
		}
		try {
			await this.options.sendText(text);
			this.emitFrame(
				'sent',
				[MESSAGE_TYPE.CALLERROR, entry.messageId, errorCode, description, details],
				text,
			);
			return true;
		} catch (error) {
			this.report(error);
			return false;
		}
	}

	private resolveResult(frame: CallResultFrame, epoch: number): void {
		if (epoch !== this.epoch) {
			return;
		}
		const entry = this.pending.get(frame[1]);
		if (entry === undefined || entry.epoch !== epoch) {
			this.report(new SimulatorError('invalid-response', `Unknown CALLRESULT ${frame[1]}`));
			return;
		}
		this.settleResolve(entry, frame[2]);
	}

	private rejectCallError(frame: CallErrorFrame, epoch: number): void {
		if (epoch !== this.epoch) {
			return;
		}
		const entry = this.pending.get(frame[1]);
		if (!isErrorCode(this.version, frame[2])) {
			this.system('warning', `Unknown OCPP ${this.version} CALLERROR code ${frame[2]}`);
		}
		if (entry === undefined || entry.epoch !== epoch) {
			this.report(new SimulatorError('invalid-response', `Unknown CALLERROR ${frame[1]}`));
			return;
		}
		const error = new SimulatorCallError({
			action: entry.action,
			messageId: entry.messageId,
			ocppErrorCode: frame[2],
			errorDescription: frame[3],
			errorDetails: frame[4],
		});
		this.settleReject(entry, error, 'rejected');
	}

	private handleMalformed(inbound: InboundFrameFailure, epoch: number): void {
		this.system('error', inbound.error.message, {
			messageType: inbound.messageType,
			messageId: inbound.messageId,
		});
		if (
			inbound.messageType === MESSAGE_TYPE.CALL &&
			inbound.messageId !== undefined &&
			epoch === this.epoch
		) {
			const code = this.version === '1.6' ? 'FormationViolation' : 'FormatViolation';
			void this.sendErrorRaw(inbound.messageId, code, 'Malformed CALL frame').catch(
				(error: unknown) => this.report(error),
			);
			return;
		}
		if (
			(inbound.messageType === MESSAGE_TYPE.CALLRESULT ||
				inbound.messageType === MESSAGE_TYPE.CALLERROR) &&
			inbound.messageId !== undefined
		) {
			const entry = this.pending.get(inbound.messageId);
			if (entry !== undefined && entry.epoch === epoch) {
				this.settleReject(
					entry,
					new SimulatorError('invalid-response', 'The peer sent a malformed response'),
					'rejected',
				);
			}
			return;
		}
		if (
			inbound.messageType === undefined &&
			inbound.messageId !== undefined &&
			this.version === '2.0.1' &&
			epoch === this.epoch
		) {
			void this.sendErrorRaw(
				inbound.messageId,
				'MessageTypeNotSupported',
				'The message type is not supported',
			).catch((error: unknown) => this.report(error));
		}
	}

	private nextMessageId(): MessageId {
		for (let attempt = 0; attempt < 16; attempt += 1) {
			const id = this.options.messageIds();
			if (typeof id !== 'string' || id === '') {
				throw new SimulatorError(
					'invalid-options',
					'The message ID generator returned an empty ID',
				);
			}
			if (id.length > 36) {
				throw new SimulatorError('invalid-options', 'The message ID is longer than 36 characters');
			}
			if (!this.pending.has(id)) {
				return id;
			}
		}
		throw new SimulatorError(
			'duplicate-message-id',
			'The message ID generator keeps repeating IDs',
		);
	}

	private settleResolve(entry: PendingEntry, payload: JsonObject): void {
		if (entry.settled) {
			return;
		}
		entry.settled = true;
		if (this.pending.get(entry.messageId) === entry) {
			this.pending.delete(entry.messageId);
		}
		entry.cancelTimeout?.();
		entry.resolve(payload);
		this.emitPending('resolved', entry, this.options.scheduler.now() - entry.createdAt);
	}

	private settleReject(
		entry: PendingEntry,
		error: SimulatorError,
		phase: 'rejected' | 'timeout' | 'cancelled',
	): void {
		if (entry.settled) {
			return;
		}
		entry.settled = true;
		if (this.pending.get(entry.messageId) === entry) {
			this.pending.delete(entry.messageId);
		}
		entry.cancelTimeout?.();
		entry.reject(error);
		this.emitPending(phase, entry, undefined, error);
	}

	private emitPending(
		phase: 'added' | 'resolved' | 'rejected' | 'timeout' | 'cancelled',
		entry: PendingEntry,
		rttMs?: number,
		error?: SimulatorError,
	): void {
		this.options.events.emit({
			type: 'pending',
			at: this.options.scheduler.now(),
			phase,
			messageId: entry.messageId,
			action: entry.action,
			...(rttMs === undefined ? {} : { rttMs }),
			...(error === undefined ? {} : { error: errorSnapshot(error) }),
		});
	}

	private rememberReplied(messageId: MessageId): void {
		this.recentlyReplied.add(messageId);
		if (this.recentlyReplied.size > 1000) {
			const oldest = this.recentlyReplied.values().next().value;
			if (oldest !== undefined) {
				this.recentlyReplied.delete(oldest);
			}
		}
	}

	private async sendFrame(frame: OcppFrame): Promise<void> {
		this.assertActive();
		if (!this.options.isOpen()) {
			throw new SimulatorError('not-connected', 'The transport is not open');
		}
		const text = writeFrame(frame);
		await this.options.sendText(text);
		this.emitFrame('sent', frame, text);
	}

	private async sendErrorRaw(
		messageId: MessageId,
		errorCode: string,
		errorDescription: string,
		errorDetails: JsonObject = {},
	): Promise<void> {
		const frame: CallErrorFrame = [
			MESSAGE_TYPE.CALLERROR,
			messageId,
			errorCode,
			errorDescription,
			errorDetails,
		];
		await this.sendFrame(frame);
	}

	private emitFrame(direction: 'sent' | 'received', frame: OcppFrame, text: string): void {
		const action = frameAction(frame);
		const entry = {
			at: this.options.scheduler.now(),
			direction,
			messageType: messageTypeName(frame[0]),
			action: action ?? messageTypeName(frame[0]),
			messageId: frameMessageId(frame),
			frame,
			text,
		} as const;
		this.options.history.add(entry);
		this.options.events.emit({ type: 'log', at: entry.at, entry });
		this.options.events.emit({
			type: 'frame',
			at: entry.at,
			direction,
			messageType: entry.messageType,
			...(action === undefined ? {} : { action }),
			messageId: entry.messageId,
			frame,
			text,
		});
	}

	private system(level: 'info' | 'warning' | 'error', message: string, data?: unknown): void {
		const entry = {
			at: this.options.scheduler.now(),
			direction: 'system' as const,
			messageType: 'SYSTEM' as const,
			action: `[${level === 'error' ? 'ERR' : level === 'warning' ? 'WARN' : 'SYS'}] ${message}`,
			level,
			...(data === undefined ? {} : { data }),
		};
		this.options.history.add(entry);
		this.options.events.emit({ type: 'log', at: entry.at, entry });
		if (level === 'error') {
			this.options.events.emit({
				type: 'error',
				at: entry.at,
				error: errorSnapshot(
					new SimulatorError('protocol-error', message, { details: toJson(data) }),
				),
				fatal: false,
			});
		}
	}

	private report(error: unknown): void {
		const at = this.options.scheduler.now();
		const message = error instanceof Error ? error.message : 'Unknown simulator error';
		const entry = {
			at,
			direction: 'system' as const,
			messageType: 'SYSTEM' as const,
			action: `[ERR] ${message}`,
			level: 'error' as const,
		};
		this.options.history.add(entry);
		this.options.events.emit({ type: 'log', at, entry });
		this.options.events.emit({
			type: 'error',
			at,
			error: errorSnapshot(error),
			fatal: false,
		});
	}

	private assertActive(): void {
		if (this.disposed) {
			throw new SimulatorError('disposed', 'The RPC framework is disposed');
		}
	}
}

function validateTimeout(timeoutMs: number): number {
	if (!Number.isFinite(timeoutMs) || timeoutMs < 0) {
		throw new SimulatorError('invalid-options', `Invalid call timeout: ${String(timeoutMs)}`);
	}
	return timeoutMs;
}

function toJson(value: unknown): JsonObject | undefined {
	if (value === undefined) {
		return undefined;
	}
	try {
		const text = JSON.stringify(value);
		if (text === undefined) {
			return undefined;
		}
		const parsed: unknown = JSON.parse(text);
		return typeof parsed === 'object' && parsed !== null && !Array.isArray(parsed)
			? (parsed as JsonObject)
			: { value: parsed as JsonObject[string] };
	} catch {
		return undefined;
	}
}
