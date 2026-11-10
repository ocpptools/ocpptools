// SPDX-License-Identifier: Apache-2.0
// SPDX-FileCopyrightText: 2026 Rodolfo Carrillo

import type { Path } from '@ocpptools/schema-utils';

import type {
	BuilderIssue,
	BuilderIssueCode,
	BuilderSource,
	BuilderWarning,
	BuilderWarningCode,
} from './types.js';

const MAX_RECEIVED_LENGTH = 40;

/** A safe error message, even when the thrown value is hostile. */
export function messageOf(error: unknown, fallback = 'unknown error'): string {
	try {
		return error instanceof Error && error.message !== '' ? error.message : fallback;
	} catch {
		return fallback;
	}
}

/** A short, safe description of a value for an issue. */
export function describeValue(value: unknown): string {
	try {
		if (value === null) return 'null';
		if (Array.isArray(value)) return 'array';
		const kind = typeof value;
		if (kind === 'string' || kind === 'number' || kind === 'boolean') {
			const text = JSON.stringify(value);
			return text.length > MAX_RECEIVED_LENGTH
				? `${text.slice(0, MAX_RECEIVED_LENGTH - 1)}…`
				: text;
		}
		return kind;
	} catch {
		return 'unreadable value';
	}
}

export function issue(
	source: BuilderSource,
	code: BuilderIssueCode,
	path: Path,
	message: string,
	expected?: string,
	received?: unknown,
): BuilderIssue {
	return {
		source,
		code,
		path,
		message,
		...(expected === undefined ? {} : { expected }),
		...(received === undefined ? {} : { received: describeValue(received) }),
	};
}

export function warning(
	source: 'schema' | 'payload',
	code: BuilderWarningCode,
	path: Path,
	message: string,
): BuilderWarning {
	return { source, code, path, message };
}

export function invalidAction(
	action: unknown,
	source: BuilderSource = 'frame',
	path: Path = [2],
): BuilderIssue {
	return issue(
		source,
		'invalid-action',
		path,
		'The action must be a non-empty string made of letters and digits',
		'non-empty action',
		action,
	);
}

export function invalidKind(kind: unknown): BuilderIssue {
	return issue(
		'schema',
		'invalid-kind',
		[],
		'The payload kind must be request or response',
		'request or response',
		kind,
	);
}

export function invalidMessageId(messageId: unknown): BuilderIssue {
	return issue(
		'frame',
		'invalid-message-id',
		[1],
		'The message ID must be a non-empty string of at most 36 characters',
		'non-empty string of at most 36 characters',
		messageId,
	);
}

export function unknownAction(action: string): BuilderIssue {
	return issue(
		'schema',
		'unknown-action',
		[],
		`No schema was found for ${action}`,
		'a schema from the registry',
		action,
	);
}

export function schemaLoadFailed(action: string, error: unknown): BuilderIssue {
	return issue(
		'schema',
		'schema-load-failed',
		[],
		`The schema registry failed for ${action}: ${messageOf(error)}`,
		'a schema from the registry',
	);
}

export function schemaInvalid(message: string, path: Path = []): BuilderIssue {
	return issue('schema', 'schema-invalid', path, message, 'a usable JSON Schema');
}

export function notJson(path: Path, message: string, value?: unknown): BuilderIssue {
	return issue('payload', 'not-json', path, message, 'a JSON value', value);
}

export function limitExceeded(path: Path, message: string): BuilderIssue {
	return issue('payload', 'limit-exceeded', path, message, 'a value within the configured limits');
}

export function serializeFailed(message: string): BuilderIssue {
	return issue('frame', 'serialize-failed', [], message, 'a serializable OCPP-J frame');
}
