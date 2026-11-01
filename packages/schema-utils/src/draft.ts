// SPDX-License-Identifier: Apache-2.0
// SPDX-FileCopyrightText: 2026 Rodolfo Carrillo

/** The JSON Schema drafts this package can read. */
export type SupportedDraft = 'draft-04' | 'draft-06' | 'draft-07';

/** A supported draft, or `unknown` for any other `$schema`. */
export type SchemaDraft = SupportedDraft | 'unknown';

/** The `$schema` value of draft-07, which is what `normalizeSchema` produces. */
export const DRAFT_07_SCHEMA_URI = 'http://json-schema.org/draft-07/schema#';

// A Map, so that no `$schema` value can reach the prototype chain.
const drafts = new Map<string, SupportedDraft>([
	['json-schema.org/draft-04/schema', 'draft-04'],
	['json-schema.org/draft-06/schema', 'draft-06'],
	['json-schema.org/draft-07/schema', 'draft-07'],
]);

/**
 * Finds the draft a schema is written in from its `$schema` keyword. The
 * scheme (`http` or `https`), a trailing `#`, and letter case do not matter.
 *
 * A schema with no `$schema`, and any value that is not an object (a boolean
 * schema, for example), is read as `defaultDraft`. A `$schema` that is not one
 * of the three supported drafts, or is not a string, gives `unknown`.
 */
export function detectDraft(
	schema: unknown,
	defaultDraft: SupportedDraft = 'draft-07',
): SchemaDraft {
	if (typeof schema !== 'object' || schema === null || Array.isArray(schema)) {
		return defaultDraft;
	}
	if (!Object.hasOwn(schema, '$schema')) {
		return defaultDraft;
	}
	const uri = (schema as Record<string, unknown>).$schema;
	if (typeof uri !== 'string') {
		return 'unknown';
	}
	const key = uri
		.replace(/^https?:\/\//i, '')
		.replace(/#$/, '')
		.toLowerCase();
	return drafts.get(key) ?? 'unknown';
}
