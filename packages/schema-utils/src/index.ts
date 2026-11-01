// SPDX-License-Identifier: Apache-2.0
// SPDX-FileCopyrightText: 2026 Rodolfo Carrillo

export { detectDraft } from './draft.js';
export type { SchemaDraft, SupportedDraft } from './draft.js';
export { getFields } from './fields.js';
export type { Field, FieldKind, GetFieldsOptions, UnsupportedReason } from './fields.js';
export { normalizeSchema } from './normalize.js';
export type {
	NormalizeError,
	NormalizeOptions,
	NormalizeWarning,
	NormalizeWarningCode,
	NormalizedSchema,
} from './normalize.js';
export { resolveRefs } from './resolve.js';
export type { ResolveError, ResolveErrorKind, ResolveOptions } from './resolve.js';
export type {
	JsonObject,
	JsonPrimitive,
	JsonSchema,
	JsonSchemaKeywords,
	JsonSchemaObject,
	JsonSchemaTypeName,
	JsonValue,
	Path,
	PathSegment,
	ResolvedJsonSchema,
	ResolvedJsonSchemaObject,
	Result,
} from './types.js';
