// SPDX-License-Identifier: Apache-2.0
// SPDX-FileCopyrightText: 2026 Rodolfo Carrillo

export { SchemaLoadError, createSchemaRegistry, schemaFileName } from './registry.js';
export type { SchemaRegistryOptions } from './registry.js';
export { createValidator } from './validator.js';
export type {
	CreateValidatorOptions,
	InvalidResult,
	PayloadKind,
	SchemaRegistry,
	ValidResult,
	ValidationIssue,
	ValidationIssueCode,
	ValidationResult,
	ValidationStatus,
	Validator,
} from './types.js';
