// SPDX-License-Identifier: Apache-2.0
// SPDX-FileCopyrightText: 2026 Rodolfo Carrillo

import type {
	CallErrorFrame,
	CallFrame,
	CallResultFrame,
	JsonObject,
	MessageIdGenerator,
	OcppVersion,
} from '@ocpptools/core';
import type { Field, Path } from '@ocpptools/schema-utils';

/** Which schema of an action to use: the request or its result. */
export type PayloadKind = 'request' | 'response';

/**
 * Gives the builder the schema of an action. It may return a schema or a
 * promise of one. The optional `actions` view is what the registry exposes;
 * the builder never invents an action list.
 */
export interface BuilderSchemaRegistry {
	get(action: string, kind: PayloadKind): unknown;
	actions?():
		Iterable<string> | AsyncIterable<string> | Promise<Iterable<string> | AsyncIterable<string>>;
}

/** Limits for schema resolution and payload checking. */
export interface BuilderLimits {
	readonly maxDepth?: number;
	readonly maxNodes?: number;
}

export interface BuilderOptions {
	readonly version: OcppVersion;
	readonly schemas: BuilderSchemaRegistry;
	readonly actions?:
		Iterable<string> | AsyncIterable<string> | Promise<Iterable<string> | AsyncIterable<string>>;
	readonly messageIds?: MessageIdGenerator;
	/** Request payload examples supplied by the consumer, keyed by action. */
	readonly examples?: Readonly<Record<string, JsonObject>>;
	readonly schemaLimits?: BuilderLimits;
	readonly payloadLimits?: BuilderLimits;
}

/** Where an issue belongs. */
export type BuilderSource = 'schema' | 'payload' | 'frame';

export type BuilderIssueCode =
	| 'unknown-action'
	| 'schema-load-failed'
	| 'schema-invalid'
	| 'invalid-action'
	| 'invalid-kind'
	| 'invalid-payload'
	| 'missing-required'
	| 'invalid-type'
	| 'invalid-enum'
	| 'out-of-range'
	| 'too-long'
	| 'too-short'
	| 'invalid-message-id'
	| 'invalid-error-code'
	| 'not-json'
	| 'limit-exceeded'
	| 'serialize-failed';

export type BuilderWarningCode =
	'unknown-draft' | 'id-conflict' | 'ignored-exclusive-bound' | 'unsupported-keyword';

/** A problem that stops a build. */
export interface BuilderIssue {
	readonly source: BuilderSource;
	readonly code: BuilderIssueCode;
	readonly path: Path;
	readonly message: string;
	readonly expected?: string;
	readonly received?: string;
}

/** Something the builder could not check, or a schema normalization warning. */
export interface BuilderWarning {
	readonly source: 'schema' | 'payload';
	readonly code: BuilderWarningCode;
	readonly path: Path;
	readonly message: string;
}

export type BuilderResult<Value> =
	| {
			readonly ok: true;
			readonly value: Value;
			readonly warnings: readonly BuilderWarning[];
	  }
	| {
			readonly ok: false;
			readonly error: BuilderIssue;
			readonly warnings: readonly BuilderWarning[];
	  };

export interface FieldsOptions {
	readonly kind?: PayloadKind;
	readonly omit?: (path: Path) => boolean;
}

export interface EmptyPayloadOptions {
	readonly kind?: PayloadKind;
	readonly fill?: 'default-or-enum' | 'typed-zero';
}

export interface BuildPayloadOptions {
	readonly kind?: PayloadKind;
	readonly applyDefaults?: boolean;
}

export interface CallOptions {
	readonly messageId?: string;
}

/** A schema-driven payload and frame builder. */
export interface Builder {
	readonly version: OcppVersion;

	has(action: string, kind?: PayloadKind): Promise<BuilderResult<boolean>>;
	listActions(): Promise<BuilderResult<readonly string[]>>;

	fields(action: string, options?: FieldsOptions): Promise<BuilderResult<Field>>;
	emptyPayload(action: string, options?: EmptyPayloadOptions): Promise<BuilderResult<JsonObject>>;
	buildPayload(
		action: string,
		value: unknown,
		options?: BuildPayloadOptions,
	): Promise<BuilderResult<JsonObject>>;

	buildCall(
		action: string,
		value: unknown,
		options?: CallOptions,
	): Promise<BuilderResult<CallFrame>>;
	buildResult(
		action: string,
		value: unknown,
		messageId: string,
	): Promise<BuilderResult<CallResultFrame>>;
	buildError(
		messageId: string,
		code: string,
		description: string,
		details?: JsonObject,
	): BuilderResult<CallErrorFrame>;

	serialize(frame: CallFrame | CallResultFrame | CallErrorFrame): BuilderResult<string>;

	example(action: string): BuilderResult<JsonObject | undefined>;
}
