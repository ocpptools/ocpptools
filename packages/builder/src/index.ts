// SPDX-License-Identifier: Apache-2.0
// SPDX-FileCopyrightText: 2026 Rodolfo Carrillo

import { createMessageIdGenerator, type MessageIdGenerator } from '@ocpptools/core';

import { invalidAction, invalidKind, issue, messageOf } from './errors.js';
import { fieldsFor } from './fields.js';
import {
	buildCallFor,
	buildErrorFor,
	buildResultFor,
	serializeFor,
	validAction,
	validKind,
} from './frame.js';
import { cloneJson } from './json.js';
import { buildPayloadFor, emptyPayloadFor } from './payload.js';
import { SchemaLoader } from './schema.js';
import type {
	Builder,
	BuilderIssue,
	BuilderOptions,
	BuilderResult,
	BuilderWarning,
	EmptyPayloadOptions,
	FieldsOptions,
	PayloadKind,
} from './types.js';
import {
	DEFAULT_PAYLOAD_MAX_DEPTH,
	DEFAULT_PAYLOAD_MAX_NODES,
	DEFAULT_SCHEMA_MAX_DEPTH,
	DEFAULT_SCHEMA_MAX_NODES,
	assertVersion,
	positiveLimit,
} from './version.js';

function failure<T>(
	error: BuilderIssue,
	warnings: readonly BuilderWarning[] = [],
): BuilderResult<T> {
	return { ok: false, error, warnings };
}

function configFailure<T>(error: unknown): BuilderResult<T> {
	return failure(
		issue(
			'schema',
			'schema-load-failed',
			[],
			`The builder options could not be read: ${messageOf(error)}`,
		),
	);
}

async function collectActions(
	source:
		| Iterable<string>
		| AsyncIterable<string>
		| Promise<Iterable<string> | AsyncIterable<string>>
		| undefined,
): Promise<readonly string[]> {
	if (source === undefined) return [];
	if (typeof source === 'string') {
		throw new Error('The action list must be an iterable of action names, not a string');
	}
	const resolved = await source;
	if (typeof resolved === 'string') {
		throw new Error('The action list must be an iterable of action names, not a string');
	}
	const result: string[] = [];
	const seen = new Set<string>();
	if (typeof (resolved as AsyncIterable<string>)[Symbol.asyncIterator] === 'function') {
		for await (const action of resolved as AsyncIterable<string>) {
			if (typeof action !== 'string' || action === '') {
				throw new Error('The action list contains a non-string or empty value');
			}
			if (!seen.has(action)) {
				seen.add(action);
				result.push(action);
			}
		}
		return result;
	}
	if (typeof (resolved as Iterable<string>)[Symbol.iterator] === 'function') {
		for (const action of resolved as Iterable<string>) {
			if (typeof action !== 'string' || action === '') {
				throw new Error('The action list contains a non-string or empty value');
			}
			if (!seen.has(action)) {
				seen.add(action);
				result.push(action);
			}
		}
		return result;
	}
	throw new Error('The action list is not iterable');
}

export function createBuilder(options: BuilderOptions): Builder {
	assertVersion(options.version);
	if (typeof options.schemas !== 'object' || options.schemas === null) {
		throw new Error('schemas must be an object with a get method');
	}
	if (typeof options.schemas.get !== 'function') {
		throw new Error('schemas.get must be a function');
	}
	if (options.messageIds !== undefined && typeof options.messageIds !== 'function') {
		throw new Error('messageIds must be a function');
	}
	if (
		options.examples !== undefined &&
		(typeof options.examples !== 'object' ||
			options.examples === null ||
			Array.isArray(options.examples))
	) {
		throw new Error('examples must be an object keyed by action');
	}
	const schemaMaxDepth = positiveLimit(
		options.schemaLimits?.maxDepth,
		DEFAULT_SCHEMA_MAX_DEPTH,
		'schemaLimits.maxDepth',
	);
	const schemaMaxNodes = positiveLimit(
		options.schemaLimits?.maxNodes,
		DEFAULT_SCHEMA_MAX_NODES,
		'schemaLimits.maxNodes',
	);
	const payloadMaxDepth = positiveLimit(
		options.payloadLimits?.maxDepth,
		DEFAULT_PAYLOAD_MAX_DEPTH,
		'payloadLimits.maxDepth',
	);
	const payloadMaxNodes = positiveLimit(
		options.payloadLimits?.maxNodes,
		DEFAULT_PAYLOAD_MAX_NODES,
		'payloadLimits.maxNodes',
	);
	const limits = { maxDepth: payloadMaxDepth, maxNodes: payloadMaxNodes };
	const loader = new SchemaLoader(options.version, options.schemas, schemaMaxDepth, schemaMaxNodes);
	let defaultMessageIds: MessageIdGenerator | undefined;
	const messageIds = (): string => {
		if (options.messageIds !== undefined) return options.messageIds();
		defaultMessageIds ??= createMessageIdGenerator();
		return defaultMessageIds();
	};
	const examples = options.examples;

	return {
		version: options.version,
		async has(action, kind: PayloadKind = 'request') {
			if (!validAction(action)) return failure(invalidAction(action, 'schema', []));
			if (!validKind(kind)) return failure(invalidKind(kind));
			const loaded = await loader.load(action, kind);
			if (loaded.ok) return { ok: true, value: true, warnings: loaded.warnings };
			if (loaded.error.code === 'unknown-action') {
				return { ok: true, value: false, warnings: loaded.warnings };
			}
			return loaded;
		},
		async listActions() {
			try {
				let source = options.actions;
				if (source === undefined && options.schemas.actions !== undefined) {
					source = options.schemas.actions();
				}
				return { ok: true, value: await collectActions(source), warnings: [] };
			} catch (error) {
				return failure(
					issue('schema', 'schema-load-failed', [], `The action list failed: ${messageOf(error)}`),
				);
			}
		},
		async fields(action, fieldsOptions: FieldsOptions = {}) {
			if (!validAction(action)) return failure(invalidAction(action, 'schema', []));
			try {
				if (fieldsOptions.kind !== undefined && !validKind(fieldsOptions.kind)) {
					return failure(invalidKind(fieldsOptions.kind));
				}
				return await fieldsFor(loader, action, fieldsOptions);
			} catch (error) {
				return configFailure(error);
			}
		},
		async emptyPayload(action, emptyOptions: EmptyPayloadOptions = {}) {
			if (!validAction(action)) return failure(invalidAction(action, 'schema', []));
			try {
				if (emptyOptions.kind !== undefined && !validKind(emptyOptions.kind)) {
					return failure(invalidKind(emptyOptions.kind));
				}
				return await emptyPayloadFor(loader, action, emptyOptions, limits);
			} catch (error) {
				return configFailure(error);
			}
		},
		async buildPayload(action, value, buildOptions = {}) {
			if (!validAction(action)) return failure(invalidAction(action, 'schema', []));
			try {
				if (buildOptions.kind !== undefined && !validKind(buildOptions.kind)) {
					return failure(invalidKind(buildOptions.kind));
				}
				return await buildPayloadFor(loader, action, value, buildOptions, limits);
			} catch (error) {
				return configFailure(error);
			}
		},
		async buildCall(action, value, callOptions: { messageId?: string } = {}) {
			try {
				return await buildCallFor(
					loader,
					options.version,
					action,
					value,
					callOptions,
					messageIds,
					limits,
				);
			} catch (error) {
				return configFailure(error);
			}
		},
		async buildResult(action, value, messageId) {
			try {
				return await buildResultFor(loader, action, value, messageId, limits);
			} catch (error) {
				return configFailure(error);
			}
		},
		buildError(messageId, code, description, details) {
			try {
				return buildErrorFor(options.version, messageId, code, description, details, limits);
			} catch (error) {
				return configFailure(error);
			}
		},
		serialize(frame) {
			try {
				return serializeFor(frame, limits);
			} catch (error) {
				return configFailure(error);
			}
		},
		example(action) {
			if (!validAction(action)) return failure(invalidAction(action, 'schema', []));
			try {
				if (examples === undefined || !Object.hasOwn(examples, action)) {
					return { ok: true, value: undefined, warnings: [] };
				}
				const cloned = cloneJson(examples[action], limits);
				if (!cloned.ok) return { ok: false, error: cloned.error, warnings: [] };
				if (
					typeof cloned.value !== 'object' ||
					cloned.value === null ||
					Array.isArray(cloned.value)
				) {
					return failure(
						issue(
							'payload',
							'invalid-payload',
							[],
							'The example must be a JSON object',
							'object',
							cloned.value,
						),
					);
				}
				return { ok: true, value: cloned.value, warnings: [] };
			} catch (error) {
				return failure(
					issue(
						'schema',
						'schema-load-failed',
						[],
						`The example could not be read: ${messageOf(error)}`,
					),
				);
			}
		},
	};
}

export type {
	Builder,
	BuilderIssue,
	BuilderIssueCode,
	BuilderOptions,
	BuilderResult,
	BuilderSchemaRegistry,
	BuilderSource,
	BuilderWarning,
	BuilderWarningCode,
	BuildPayloadOptions,
	CallOptions,
	EmptyPayloadOptions,
	FieldsOptions,
	PayloadKind,
} from './types.js';
export type { JsonLimits } from './json.js';
