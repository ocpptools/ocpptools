// SPDX-License-Identifier: Apache-2.0
// SPDX-FileCopyrightText: 2026 Rodolfo Carrillo

import type { BuilderResult, BuilderSchemaRegistry, BuilderWarning, PayloadKind } from './types.js';
import type { OcppVersion } from '@ocpptools/core';
import type { Path, ResolvedJsonSchema } from '@ocpptools/schema-utils';
import { normalizeSchema, resolveRefs } from '@ocpptools/schema-utils';

import { schemaInvalid, schemaLoadFailed, unknownAction, messageOf } from './errors.js';
import { versionDefaults } from './version.js';

export interface LoadedSchema {
	readonly schema: ResolvedJsonSchema;
	readonly warnings: readonly BuilderWarning[];
}

function isModuleNamespace(value: unknown): boolean {
	if (typeof value !== 'object' || value === null) return false;
	try {
		return (
			Object.prototype.toString.call(value) === '[object Module]' ||
			(value as { __esModule?: unknown }).__esModule === true
		);
	} catch {
		return false;
	}
}

function pathOf(value: unknown): Path {
	return Array.isArray(value) ? (value as Path) : [];
}

export class SchemaLoader {
	private readonly cache = new Map<string, Promise<BuilderResult<LoadedSchema>>>();

	constructor(
		private readonly version: OcppVersion,
		private readonly schemas: BuilderSchemaRegistry,
		private readonly maxDepth: number,
		private readonly maxNodes: number,
	) {}

	load(action: string, kind: PayloadKind): Promise<BuilderResult<LoadedSchema>> {
		const key = `${kind}\u0000${action}`;
		const cached = this.cache.get(key);
		if (cached !== undefined) return cached;
		const pending = this.loadUncached(action, kind);
		this.cache.set(key, pending);
		void pending.then(
			(result) => {
				if (!result.ok) this.cache.delete(key);
			},
			() => {
				this.cache.delete(key);
			},
		);
		return pending;
	}

	private async loadUncached(
		action: string,
		kind: PayloadKind,
	): Promise<BuilderResult<LoadedSchema>> {
		let raw: unknown;
		try {
			raw = await this.schemas.get(action, kind);
		} catch (error) {
			return { ok: false, error: schemaLoadFailed(action, error), warnings: [] };
		}
		if (raw === undefined) {
			return { ok: false, error: unknownAction(action), warnings: [] };
		}
		if (isModuleNamespace(raw)) {
			return {
				ok: false,
				error: schemaInvalid('The registry returned a module namespace; return its default export'),
				warnings: [],
			};
		}

		let normalized;
		try {
			normalized = normalizeSchema(raw, {
				defaultDraft: versionDefaults(this.version).defaultDraft,
				stripUnknownKeywords: true,
			});
		} catch (error) {
			return {
				ok: false,
				error: schemaInvalid(messageOf(error, 'The schema could not be read')),
				warnings: [],
			};
		}
		if (!normalized.ok) {
			return {
				ok: false,
				error: schemaInvalid(normalized.error.message, pathOf(normalized.error.path)),
				warnings: [],
			};
		}
		const warnings: BuilderWarning[] = normalized.value.warnings.map((entry) => ({
			source: 'schema',
			code: entry.code,
			path: entry.path,
			message: entry.message,
		}));

		let resolved;
		try {
			resolved = resolveRefs(normalized.value.schema, {
				dropDefinitions: true,
				maxDepth: this.maxDepth,
				maxNodes: this.maxNodes,
			});
		} catch (error) {
			return {
				ok: false,
				error: schemaInvalid(messageOf(error, 'The schema could not be read')),
				warnings,
			};
		}
		if (!resolved.ok) {
			return {
				ok: false,
				error: schemaInvalid(
					resolved.error.ref === undefined
						? resolved.error.message
						: `${resolved.error.message} (${resolved.error.ref})`,
					pathOf(resolved.error.path),
				),
				warnings,
			};
		}
		return { ok: true, value: { schema: resolved.value, warnings }, warnings };
	}
}
