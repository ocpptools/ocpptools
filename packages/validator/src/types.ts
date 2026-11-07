// SPDX-License-Identifier: Apache-2.0
// SPDX-FileCopyrightText: 2026 Rodolfo Carrillo

import type { FrameIssueCode, MessageId, MessageType, OcppVersion } from '@ocpptools/core';

/** Which schema of an action to use: the one of the CALL or the one of its CALLRESULT. */
export type PayloadKind = 'request' | 'response';

/**
 * How a validation ended:
 *
 * - `valid`: nothing is wrong. There can still be warnings.
 * - `invalid-frame`: the text is not JSON, or the frame is not a well-formed OCPP-J frame.
 * - `unknown-action`: the registry has no schema for the action.
 * - `schema-missing`: the action is known, but its schema could not be loaded or used.
 * - `invalid-payload`: the payload does not match the schema.
 */
export type ValidationStatus =
	'valid' | 'invalid-frame' | 'unknown-action' | 'schema-missing' | 'invalid-payload';

/**
 * What is wrong. The first group is the frame checks of `@ocpptools/core`. The
 * others are specific to this package:
 *
 * - `invalid-json`: the input text is not valid JSON.
 * - `schema-invalid`: the schema of the action cannot be used, for example Ajv cannot compile it.
 * - `schema-load-failed`: the registry failed to provide the schema.
 * - `unchecked-result`: a CALLRESULT was not checked because its request action is unknown (a warning).
 * - `schema-violation`: the payload breaks a rule of the schema; `keyword` says which one.
 */
export type ValidationIssueCode =
	| FrameIssueCode
	| 'invalid-json'
	| 'schema-invalid'
	| 'schema-load-failed'
	| 'unchecked-result'
	| 'schema-violation';

/** A problem or a warning found while validating. */
export interface ValidationIssue {
	readonly code: ValidationIssueCode;
	/** Where the problem is, as property names (strings) and array indexes (numbers). */
	readonly path: readonly (string | number)[];
	/** `path` as a JSON Pointer (RFC 6901), for example `/3/idTag`. Empty for the whole input. */
	readonly pointer: string;
	readonly message: string;
	/** The JSON Schema keyword that failed, such as `required` or `type`. Only for `schema-violation`. */
	readonly keyword?: string;
	/** What should be there, in words. */
	readonly expected?: string;
	/** What is there: its JSON when it is short, or its type. */
	readonly received?: string;
}

interface ValidationResultBase {
	/** The message type, when the frame has a valid one. */
	readonly messageType?: MessageType;
	/** The message ID, when it is a non-empty string. Use it to reply with a CALLERROR. */
	readonly messageId?: MessageId;
	/** The action that was checked, when there is one. */
	readonly action?: string;
	/**
	 * Everything that makes the input invalid. Empty when `valid` is true, and
	 * when the status alone explains the failure, such as `unknown-action`.
	 */
	readonly issues: readonly ValidationIssue[];
	/** Things worth knowing that do not make the input invalid. */
	readonly warnings: readonly ValidationIssue[];
}

/** The input is valid. */
export interface ValidResult extends ValidationResultBase {
	readonly status: 'valid';
	readonly valid: true;
}

/** The input is not valid; `status` says why and `issues` says what. */
export interface InvalidResult extends ValidationResultBase {
	readonly status: Exclude<ValidationStatus, 'valid'>;
	readonly valid: false;
}

export type ValidationResult = ValidResult | InvalidResult;

/**
 * Gives the validator the JSON Schema of an action. `get` returns the schema,
 * `undefined` when the action does not exist, or a promise of either. If the
 * promise rejects, the schema exists but could not be loaded. The package
 * contains no schemas: the registry decides where they come from.
 */
export interface SchemaRegistry {
	get(action: string, kind: PayloadKind): unknown;
}

/** What `createValidator` needs: one OCPP version and where its schemas come from. */
export interface CreateValidatorOptions {
	readonly version: OcppVersion;
	readonly schemas: SchemaRegistry;
}

/** Validates values for one OCPP version. */
export interface Validator {
	readonly version: OcppVersion;
	validatePayload(action: string, kind: PayloadKind, payload: unknown): Promise<ValidationResult>;
}
