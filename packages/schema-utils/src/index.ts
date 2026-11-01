// SPDX-License-Identifier: Apache-2.0
// SPDX-FileCopyrightText: 2026 Rodolfo Carrillo

export { detectDraft } from './draft.js';
export type { SchemaDraft, SupportedDraft } from './draft.js';
export { normalizeSchema } from './normalize.js';
export type {
	NormalizeError,
	NormalizeOptions,
	NormalizeWarning,
	NormalizeWarningCode,
	NormalizedSchema,
} from './normalize.js';
export type {
	JsonObject,
	JsonPrimitive,
	JsonSchema,
	JsonSchemaObject,
	JsonSchemaTypeName,
	JsonValue,
	Path,
	PathSegment,
	Result,
} from './types.js';
