// SPDX-License-Identifier: Apache-2.0
// SPDX-FileCopyrightText: 2026 Rodolfo Carrillo

import {
	MESSAGE_TYPE,
	inspectFrame,
	isErrorCode,
	isOcppVersion,
	parseFrame,
	serializeFrame,
	type CallErrorFrame,
	type CallFrame,
	type CallResultFrame,
	type FrameIssue,
	type JsonObject,
	type MessageId,
	type OcppFrame,
	type OcppVersion,
	type Transport,
	type TransportCloseEvent,
	type Unsubscribe,
} from '@ocpptools/core';

import { MockCsmsCallError, MockCsmsError } from '../errors.js';
import { assertPlainJson, isPlainJsonObject, PlainJsonError } from '../plain-json.js';

export interface MockCsmsContext {
	readonly version: OcppVersion;
	readonly csms: MockCsms;
	readonly call: CallFrame;
}

export type MockCsmsHandler = (
	call: CallFrame,
	context: MockCsmsContext,
) => JsonObject | undefined | Promise<JsonObject | undefined>;

export interface MockCsmsOptions {
	readonly version: OcppVersion;
	readonly transport: Transport;
	readonly handlers?: Readonly<Record<string, MockCsmsHandler>>;
	readonly autoRespond?: 'empty' | 'handlers';
	readonly replyToInvalidFrames?: boolean;
	readonly allowInvalidErrorCodes?: boolean;
	readonly messageIds?: () => string;
	readonly validateCall?: (call: CallFrame) => void | Promise<void>;
	readonly validateResult?: (result: CallResultFrame) => void | Promise<void>;
	readonly onIssue?: (issue: MockCsmsIssue) => void;
}

export interface MockCsmsCallOptions {
	readonly messageId?: string;
}

export type MockCsmsIssueCode =
	| 'duplicate-message-id'
	| 'handler-failed'
	| 'parse-failed'
	| 'send-failed'
	| 'serialization-failed'
	| 'stopped'
	| 'transport-closed'
	| 'unknown-error-code'
	| 'unexpected-response';

export interface MockCsmsIssue {
	readonly code: MockCsmsIssueCode;
	readonly message: string;
	readonly frame?: unknown;
	readonly frameIssues?: readonly FrameIssue[];
	readonly cause?: unknown;
}

export interface MockCsms {
	readonly version: OcppVersion;
	readonly transport: Transport;
	readonly state: 'closed' | 'connecting' | 'open';
	readonly calls: readonly CallFrame[];
	readonly results: readonly CallResultFrame[];
	readonly errors: readonly CallErrorFrame[];
	readonly rawReceived: readonly string[];
	readonly rawSent: readonly string[];
	readonly received: readonly OcppFrame[];
	readonly sent: readonly OcppFrame[];
	readonly pending: readonly CallFrame[];
	readonly issues: readonly MockCsmsIssue[];
	/** Waits until every in-flight handler, validator and response completes. */
	waitForIdle(): Promise<void>;
	start(): void;
	stop(): void;
	call(
		action: string,
		payload: JsonObject,
		options?: MockCsmsCallOptions,
	): Promise<CallResultFrame>;
	waitForCall(action: string): Promise<CallFrame>;
	respond(call: CallFrame | MessageId, payload: JsonObject): void;
	reject(
		call: CallFrame | MessageId,
		code: string,
		description: string,
		details?: JsonObject,
	): void;
}

interface PendingInbound {
	readonly call: CallFrame;
	claimed: boolean;
	settled: boolean;
}

interface PendingOutbound {
	readonly messageId: MessageId;
	readonly resolve: (frame: CallResultFrame) => void;
	readonly reject: (error: unknown) => void;
	claimed: boolean;
}

interface CallWaiter {
	readonly action: string;
	readonly resolve: (call: CallFrame) => void;
	readonly reject: (error: unknown) => void;
}

function safeMessage(error: unknown, fallback = 'unknown error'): string {
	try {
		return error instanceof Error && typeof error.message === 'string' && error.message !== ''
			? error.message
			: fallback;
	} catch {
		return fallback;
	}
}

function plainError(error: unknown): MockCsmsError {
	if (error instanceof PlainJsonError) {
		return new MockCsmsError('serialization-failed', error.message, { cause: error });
	}
	return new MockCsmsError('serialization-failed', 'The value is not plain JSON', {
		cause: error,
	});
}

function assertJsonObject(value: unknown, label: string): asserts value is JsonObject {
	try {
		assertPlainJson(value);
	} catch (error) {
		throw plainError(error);
	}
	if (!isPlainJsonObject(value)) {
		throw new MockCsmsError('serialization-failed', `The ${label} must be a JSON object`);
	}
}

class MockCsmsImpl implements MockCsms {
	readonly version: OcppVersion;
	readonly transport: Transport;
	private stateValue: 'closed' | 'connecting' | 'open';
	private readonly handlers: Map<string, MockCsmsHandler>;
	private readonly autoRespond: 'empty' | 'handlers';
	private readonly replyToInvalidFrames: boolean;
	private readonly allowInvalidErrorCodes: boolean;
	private readonly messageIds: () => string;
	private readonly validateCall: ((call: CallFrame) => void | Promise<void>) | undefined;
	private readonly validateResult: ((result: CallResultFrame) => void | Promise<void>) | undefined;
	private readonly onIssue: ((issue: MockCsmsIssue) => void) | undefined;
	private readonly callsList: CallFrame[] = [];
	private readonly resultsList: CallResultFrame[] = [];
	private readonly errorsList: CallErrorFrame[] = [];
	private readonly rawReceivedList: string[] = [];
	private readonly rawSentList: string[] = [];
	private readonly receivedList: OcppFrame[] = [];
	private readonly sentList: OcppFrame[] = [];
	private readonly pendingInbound: PendingInbound[] = [];
	private readonly pendingOutbound = new Map<MessageId, PendingOutbound>();
	private readonly unreadCalls: CallFrame[] = [];
	private readonly callWaiters: CallWaiter[] = [];
	private readonly issuesList: MockCsmsIssue[] = [];
	private readonly subscriptions: Unsubscribe[] = [];
	private readonly seenInboundIds = new Set<MessageId>();
	private readonly activeDispatches = new Set<Promise<void>>();
	private readonly idleWaiters: Array<() => void> = [];
	private started = false;
	private nextMessageId = 0;

	constructor(options: MockCsmsOptions) {
		if (!isOcppVersion(options.version)) {
			throw new MockCsmsError('protocol', `Unsupported OCPP version: ${String(options.version)}`);
		}
		if (
			options.autoRespond !== undefined &&
			options.autoRespond !== 'handlers' &&
			options.autoRespond !== 'empty'
		) {
			throw new MockCsmsError('protocol', 'autoRespond must be "handlers" or "empty"');
		}
		if (options.transport.state === 'closed' || options.transport.state === 'closing') {
			throw new MockCsmsError('closed', 'The transport is not usable');
		}
		this.version = options.version;
		this.transport = options.transport;
		this.handlers = new Map(Object.entries(options.handlers ?? {}));
		this.autoRespond = options.autoRespond ?? 'handlers';
		this.replyToInvalidFrames = options.replyToInvalidFrames === true;
		this.allowInvalidErrorCodes = options.allowInvalidErrorCodes === true;
		this.messageIds = options.messageIds ?? (() => `msg-${String((this.nextMessageId += 1))}`);
		this.validateCall = options.validateCall;
		this.validateResult = options.validateResult;
		this.onIssue = options.onIssue;
		this.stateValue = options.transport.state === 'open' ? 'open' : 'connecting';
		this.start();
	}

	get state(): 'closed' | 'connecting' | 'open' {
		return this.stateValue;
	}

	get calls(): readonly CallFrame[] {
		return [...this.callsList];
	}

	get results(): readonly CallResultFrame[] {
		return [...this.resultsList];
	}

	get errors(): readonly CallErrorFrame[] {
		return [...this.errorsList];
	}

	get rawReceived(): readonly string[] {
		return [...this.rawReceivedList];
	}

	get rawSent(): readonly string[] {
		return [...this.rawSentList];
	}

	get received(): readonly OcppFrame[] {
		return [...this.receivedList];
	}

	get sent(): readonly OcppFrame[] {
		return [...this.sentList];
	}

	get pending(): readonly CallFrame[] {
		return this.pendingInbound.filter((entry) => !entry.settled).map((entry) => entry.call);
	}

	get issues(): readonly MockCsmsIssue[] {
		return [...this.issuesList];
	}

	waitForIdle(): Promise<void> {
		if (this.stateValue === 'closed' || this.activeDispatches.size === 0) {
			return Promise.resolve();
		}
		return new Promise<void>((resolve) => {
			this.idleWaiters.push(resolve);
		});
	}

	start(): void {
		if (this.started || this.stateValue === 'closed') return;
		this.started = true;
		this.subscriptions.push(
			this.transport.onOpen(() => {
				if (this.stateValue === 'connecting') this.stateValue = 'open';
			}),
			this.transport.onMessage((text) => {
				if (this.stateValue === 'closed') return;
				this.rawReceivedList.push(text);
				const task = this.dispatch(text).catch((error) => {
					this.recordIssue('handler-failed', safeMessage(error), text, undefined, error);
				});
				this.activeDispatches.add(task);
				void task.finally(() => {
					this.activeDispatches.delete(task);
					if (this.activeDispatches.size === 0) {
						for (const resolve of this.idleWaiters.splice(0)) resolve();
					}
				});
			}),
			this.transport.onClose((event) => {
				this.transportClosed(event);
			}),
			this.transport.onError((error) => {
				this.closeWith(
					new MockCsmsError('closed', 'The transport failed', { cause: error }),
					'transport-closed',
				);
			}),
		);
		if (this.transport.state === 'open') this.stateValue = 'open';
	}

	stop(): void {
		if (this.stateValue === 'closed') return;
		this.closeWith(new MockCsmsError('closed', 'The mock CSMS stopped'), 'stopped');
	}

	async call(
		action: string,
		payload: JsonObject,
		options: MockCsmsCallOptions = {},
	): Promise<CallResultFrame> {
		this.ensureOpen();
		if (typeof action !== 'string' || action === '') {
			throw new MockCsmsError('protocol', 'The action must be a non-empty string');
		}
		try {
			assertJsonObject(payload, 'payload');
		} catch (error) {
			this.recordIssue('serialization-failed', safeMessage(error), payload, undefined, error);
			throw error;
		}
		let messageId: unknown;
		try {
			messageId = options.messageId ?? this.messageIds();
		} catch (error) {
			throw new MockCsmsError('protocol', 'The message ID generator failed', { cause: error });
		}
		if (typeof messageId !== 'string' || messageId === '') {
			throw new MockCsmsError('protocol', 'The message ID must be a non-empty string');
		}
		if (this.pendingOutbound.has(messageId)) {
			throw new MockCsmsError('duplicate-message-id', `The message ID ${messageId} is pending`);
		}
		const frame: CallFrame = [MESSAGE_TYPE.CALL, messageId, action, payload];
		let text: string;
		try {
			text = this.serialize(frame);
		} catch (error) {
			this.recordIssue('serialization-failed', safeMessage(error), frame, undefined, error);
			throw error instanceof MockCsmsError
				? error
				: new MockCsmsError('serialization-failed', safeMessage(error), { cause: error });
		}
		let resolve!: (frame: CallResultFrame) => void;
		let reject!: (error: unknown) => void;
		const promise = new Promise<CallResultFrame>((resolveValue, rejectValue) => {
			resolve = resolveValue;
			reject = rejectValue;
		});
		this.pendingOutbound.set(messageId, {
			messageId,
			resolve,
			reject,
			claimed: false,
		});
		try {
			this.transport.send(text);
		} catch (error) {
			this.pendingOutbound.delete(messageId);
			this.recordIssue('send-failed', safeMessage(error), text, undefined, error);
			throw new MockCsmsError('send-failed', safeMessage(error), { cause: error });
		}
		this.recordSent(text, frame);
		return promise;
	}

	waitForCall(action: string): Promise<CallFrame> {
		if (typeof action !== 'string' || action === '') {
			return Promise.reject(new MockCsmsError('protocol', 'The action must be a non-empty string'));
		}
		if (this.stateValue === 'closed') {
			return Promise.reject(new MockCsmsError('closed', 'The mock CSMS is closed'));
		}
		const index = this.unreadCalls.findIndex((call) => call[2] === action);
		if (index !== -1) {
			const [call] = this.unreadCalls.splice(index, 1);
			if (call !== undefined) return Promise.resolve(call);
		}
		return new Promise<CallFrame>((resolve, reject) => {
			this.callWaiters.push({ action, resolve, reject });
		});
	}

	respond(call: CallFrame | MessageId, payload: JsonObject): void {
		this.ensureOpen();
		const entry = this.findPending(call);
		if (entry === undefined) {
			throw new MockCsmsError('protocol', 'No pending call matches the response');
		}
		if (!this.claim(entry)) {
			throw new MockCsmsError('protocol', 'The call already has a responder');
		}
		try {
			assertJsonObject(payload, 'payload');
			this.sendResult(entry, payload);
			this.settle(entry);
		} catch (error) {
			this.recordResponseError(entry, error);
			this.release(entry);
			throw error instanceof MockCsmsError ? error : plainError(error);
		}
	}

	reject(
		call: CallFrame | MessageId,
		code: string,
		description: string,
		details: JsonObject = {},
	): void {
		this.ensureOpen();
		const entry = this.findPending(call);
		if (entry === undefined) {
			throw new MockCsmsError('protocol', 'No pending call matches the response');
		}
		if (!this.claim(entry)) {
			throw new MockCsmsError('protocol', 'The call already has a responder');
		}
		try {
			this.assertErrorCode(code);
			assertJsonObject(details, 'details');
			this.sendError(entry, code, description, details);
			this.settle(entry);
		} catch (error) {
			this.recordResponseError(entry, error);
			this.release(entry);
			throw error instanceof MockCsmsError ? error : plainError(error);
		}
	}

	private async dispatch(text: string): Promise<void> {
		let raw: unknown;
		try {
			raw = JSON.parse(text);
		} catch (error) {
			this.recordIssue('parse-failed', 'Frame is not valid JSON', text, undefined, error);
			return;
		}
		const inspection = inspectFrame(raw, { version: this.version });
		const parsed = parseFrame(text);
		if (!parsed.ok || inspection.messageType === undefined) {
			this.recordIssue(
				'parse-failed',
				parsed.ok ? 'Frame has no message type' : parsed.error.message,
				text,
				inspection.issues.filter((issue) => issue.severity === 'error'),
			);
			this.handleMalformed(raw, inspection);
			return;
		}
		for (const issue of inspection.issues) {
			if (issue.code === 'unknown-error-code') {
				this.recordIssue('unknown-error-code', issue.message, text);
			}
		}
		this.receivedList.push(parsed.value);
		if (parsed.value[0] === MESSAGE_TYPE.CALL) {
			await this.handleInboundCall(parsed.value);
		} else if (parsed.value[0] === MESSAGE_TYPE.CALLRESULT) {
			await this.handleResult(parsed.value);
		} else {
			this.handleError(parsed.value);
		}
	}

	private handleMalformed(raw: unknown, inspection: ReturnType<typeof inspectFrame>): void {
		const messageId = inspection.messageId;
		const type = Array.isArray(raw) ? (raw as readonly unknown[])[0] : undefined;
		if (type === MESSAGE_TYPE.CALLRESULT || type === MESSAGE_TYPE.CALLERROR) {
			if (messageId !== undefined) {
				const pending = this.pendingOutbound.get(messageId);
				if (pending !== undefined && !pending.claimed) {
					pending.claimed = true;
					this.pendingOutbound.delete(messageId);
					pending.reject(new MockCsmsError('protocol', 'The peer sent a malformed response'));
				}
			}
			return;
		}
		if (!this.replyToInvalidFrames || messageId === undefined) return;
		const code =
			type !== MESSAGE_TYPE.CALL && this.version === '2.0.1'
				? 'MessageTypeNotSupported'
				: this.version === '2.0.1'
					? 'FormatViolation'
					: 'FormationViolation';
		try {
			this.sendErrorById(messageId, code, 'Malformed frame', {});
		} catch (error) {
			this.recordIssue('send-failed', safeMessage(error), raw, undefined, error);
		}
	}

	private async handleInboundCall(call: CallFrame): Promise<void> {
		if (this.seenInboundIds.has(call[1])) {
			this.recordIssue('duplicate-message-id', `Duplicate CALL message ID ${call[1]}`, call);
		} else {
			this.seenInboundIds.add(call[1]);
		}
		this.callsList.push(call);
		const entry: PendingInbound = { call, claimed: false, settled: false };
		this.pendingInbound.push(entry);
		this.notifyCall(call);
		await this.processInbound(entry);
	}

	private async processInbound(entry: PendingInbound): Promise<void> {
		if (!this.claim(entry)) return;
		try {
			if (this.validateCall !== undefined) {
				try {
					await this.validateCall(entry.call);
				} catch (error) {
					this.handleCallbackFailure(entry, error);
					return;
				}
			}
			const handler = this.handlers.get(entry.call[2]);
			if (handler === undefined) {
				if (this.autoRespond === 'empty') {
					this.respondAutomatically(entry, {});
				} else {
					this.release(entry);
				}
				return;
			}
			let result: JsonObject | undefined;
			try {
				result = await handler(entry.call, {
					version: this.version,
					csms: this,
					call: entry.call,
				});
			} catch (error) {
				this.handleCallbackFailure(entry, error);
				return;
			}
			if (result === undefined) {
				this.release(entry);
				return;
			}
			this.respondAutomatically(entry, result);
		} catch (error) {
			this.recordIssue('handler-failed', safeMessage(error), entry.call, undefined, error);
			this.release(entry);
		}
	}

	private handleCallbackFailure(entry: PendingInbound, error: unknown): void {
		if (error instanceof MockCsmsCallError) {
			const valid = error.code !== '' && isErrorCode(this.version, error.code);
			if (valid || (this.allowInvalidErrorCodes && error.code !== '')) {
				this.respondAutomatically(entry, undefined, {
					code: error.code,
					description: error.description,
					details: error.details,
				});
				return;
			}
			this.recordIssue('unknown-error-code', `Invalid error code ${error.code}`, entry.call);
			this.respondAutomatically(entry, undefined, {
				code: 'InternalError',
				description: 'Invalid error code',
				details: {},
			});
			return;
		}
		this.recordIssue('handler-failed', safeMessage(error), entry.call, undefined, error);
		this.respondAutomatically(entry, undefined, {
			code: 'InternalError',
			description: 'Handler failed',
			details: {},
		});
	}

	private respondAutomatically(
		entry: PendingInbound,
		payload: JsonObject | undefined,
		error?: { readonly code: string; readonly description: string; readonly details: JsonObject },
	): void {
		if (this.stateValue === 'closed' || entry.settled) return;
		try {
			if (error === undefined) {
				if (payload === undefined) {
					this.release(entry);
					return;
				}
				this.sendResult(entry, payload);
			} else {
				this.sendError(entry, error.code, error.description, error.details);
			}
			this.settle(entry);
		} catch (sendError) {
			const code = sendError instanceof MockCsmsError ? sendError.code : 'send-failed';
			if (code === 'serialization-failed' || code === 'send-failed') {
				this.recordIssue(code, safeMessage(sendError), entry.call, undefined, sendError);
			}
			if (code === 'serialization-failed' && this.stateValue === 'open' && !entry.settled) {
				try {
					this.sendError(entry, 'InternalError', 'Handler returned invalid JSON', {});
					this.settle(entry);
					return;
				} catch (fallbackError) {
					this.recordIssue(
						'send-failed',
						safeMessage(fallbackError),
						entry.call,
						undefined,
						fallbackError,
					);
				}
			}
			this.release(entry);
		}
	}

	private async handleResult(result: CallResultFrame): Promise<void> {
		const pending = this.pendingOutbound.get(result[1]);
		if (pending === undefined) {
			this.recordIssue('unexpected-response', `No pending call for ${result[1]}`, result);
			return;
		}
		if (pending.claimed) {
			this.recordIssue('unexpected-response', `Duplicate response for ${result[1]}`, result);
			return;
		}
		pending.claimed = true;
		if (this.validateResult !== undefined) {
			try {
				await this.validateResult(result);
			} catch (error) {
				if (!this.pendingOutbound.has(result[1])) return;
				this.pendingOutbound.delete(result[1]);
				pending.reject(
					error instanceof MockCsmsCallError
						? error
						: new MockCsmsError('protocol', safeMessage(error), { cause: error }),
				);
				this.recordIssue('handler-failed', safeMessage(error), result, undefined, error);
				return;
			}
		}
		if (!this.pendingOutbound.has(result[1])) return;
		this.pendingOutbound.delete(result[1]);
		pending.resolve(result);
	}

	private handleError(frame: CallErrorFrame): void {
		const pending = this.pendingOutbound.get(frame[1]);
		if (pending === undefined) {
			this.recordIssue('unexpected-response', `No pending call for ${frame[1]}`, frame);
			return;
		}
		if (pending.claimed) {
			this.recordIssue('unexpected-response', `Duplicate response for ${frame[1]}`, frame);
			return;
		}
		pending.claimed = true;
		this.pendingOutbound.delete(frame[1]);
		pending.reject(new MockCsmsCallError(frame[2], frame[3], frame[4], { origin: 'peer' }));
	}

	private notifyCall(call: CallFrame): void {
		const index = this.callWaiters.findIndex((waiter) => waiter.action === call[2]);
		if (index === -1) {
			this.unreadCalls.push(call);
			return;
		}
		const [waiter] = this.callWaiters.splice(index, 1);
		waiter?.resolve(call);
	}

	private findPending(call: CallFrame | MessageId): PendingInbound | undefined {
		if (typeof call === 'string') {
			return this.pendingInbound.find((entry) => !entry.settled && entry.call[1] === call);
		}
		return this.pendingInbound.find(
			(entry) =>
				!entry.settled &&
				(entry.call === call ||
					(entry.call[1] === call[1] &&
						entry.call[2] === call[2] &&
						JSON.stringify(entry.call[3]) === JSON.stringify(call[3]))),
		);
	}

	private claim(entry: PendingInbound): boolean {
		if (entry.settled || entry.claimed) return false;
		entry.claimed = true;
		return true;
	}

	private release(entry: PendingInbound): void {
		if (!entry.settled) entry.claimed = false;
	}

	private settle(entry: PendingInbound): void {
		if (entry.settled) return;
		entry.settled = true;
		entry.claimed = true;
		const index = this.pendingInbound.indexOf(entry);
		if (index !== -1) this.pendingInbound.splice(index, 1);
	}

	private ensureOpen(): void {
		if (this.stateValue === 'closed') {
			throw new MockCsmsError('closed', 'The mock CSMS is closed');
		}
		if (this.stateValue !== 'open' || this.transport.state !== 'open') {
			throw new MockCsmsError('not-open', 'The mock CSMS is not open');
		}
	}

	private assertErrorCode(code: string): void {
		if (typeof code !== 'string' || code === '') {
			throw new MockCsmsError('protocol', 'The error code must be a non-empty string');
		}
		if (!this.allowInvalidErrorCodes && !isErrorCode(this.version, code)) {
			throw new MockCsmsError(
				'protocol',
				`The error code ${code} is not valid for ${this.version}`,
			);
		}
	}

	private sendResult(entry: PendingInbound, payload: JsonObject): void {
		assertJsonObject(payload, 'payload');
		this.sendFrame([MESSAGE_TYPE.CALLRESULT, entry.call[1], payload]);
	}

	private sendError(
		entry: PendingInbound,
		code: string,
		description: string,
		details: JsonObject,
	): void {
		if (!this.allowInvalidErrorCodes) this.assertErrorCode(code);
		assertJsonObject(details, 'details');
		this.sendFrame([MESSAGE_TYPE.CALLERROR, entry.call[1], code, description, details]);
	}

	private sendErrorById(
		messageId: MessageId,
		code: string,
		description: string,
		details: JsonObject,
	): void {
		this.sendFrame([MESSAGE_TYPE.CALLERROR, messageId, code, description, details]);
	}

	private sendFrame(frame: OcppFrame): void {
		const text = this.serialize(frame);
		if (this.stateValue !== 'open' || this.transport.state !== 'open') {
			throw new MockCsmsError('closed', 'The mock CSMS is not open');
		}
		try {
			this.transport.send(text);
		} catch (error) {
			throw new MockCsmsError('send-failed', safeMessage(error), { cause: error });
		}
		this.recordSent(text, frame);
	}

	private serialize(frame: OcppFrame): string {
		const serialized = serializeFrame(frame);
		if (!serialized.ok) {
			throw new MockCsmsError('serialization-failed', serialized.error.message);
		}
		return serialized.value;
	}

	private recordSent(text: string, frame: OcppFrame): void {
		this.rawSentList.push(text);
		const parsed = parseFrame(text);
		const value = parsed.ok ? parsed.value : frame;
		this.sentList.push(value);
		if (value[0] === MESSAGE_TYPE.CALLRESULT) this.resultsList.push(value);
		if (value[0] === MESSAGE_TYPE.CALLERROR) this.errorsList.push(value);
	}

	private recordResponseError(entry: PendingInbound, error: unknown): void {
		if (!(error instanceof MockCsmsError)) return;
		if (error.code === 'serialization-failed' || error.code === 'send-failed') {
			this.recordIssue(error.code, error.message, entry.call, undefined, error);
		}
	}

	private transportClosed(event: TransportCloseEvent): void {
		if (this.stateValue === 'closed') return;
		this.closeWith(
			new MockCsmsError('closed', `The transport closed: ${event.reason}`),
			'transport-closed',
		);
	}

	private closeWith(error: MockCsmsError, issueCode: 'stopped' | 'transport-closed'): void {
		if (this.stateValue === 'closed') return;
		this.stateValue = 'closed';
		for (const unsubscribe of this.subscriptions.splice(0)) unsubscribe();
		for (const pending of this.pendingOutbound.values()) {
			pending.claimed = true;
			pending.reject(error);
		}
		this.pendingOutbound.clear();
		for (const waiter of this.callWaiters.splice(0)) waiter.reject(error);
		for (const resolve of this.idleWaiters.splice(0)) resolve();
		for (const entry of this.pendingInbound) {
			entry.settled = true;
			entry.claimed = true;
		}
		this.pendingInbound.length = 0;
		this.unreadCalls.length = 0;
		this.recordIssue(issueCode, error.message);
	}

	private recordIssue(
		code: MockCsmsIssueCode,
		message: string,
		frame?: unknown,
		frameIssues?: readonly FrameIssue[],
		cause?: unknown,
	): void {
		const issue: MockCsmsIssue = {
			code,
			message,
			...(frame === undefined ? {} : { frame }),
			...(frameIssues === undefined ? {} : { frameIssues }),
			...(cause === undefined ? {} : { cause }),
		};
		this.issuesList.push(issue);
		try {
			this.onIssue?.(issue);
		} catch {
			// An observer must not break the mock.
		}
	}
}

/** Creates a transport-agnostic mock CSMS with no built-in handlers. */
export function createMockCsms(options: MockCsmsOptions): MockCsms {
	return new MockCsmsImpl(options);
}
