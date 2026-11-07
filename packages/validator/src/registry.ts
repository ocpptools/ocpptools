// SPDX-License-Identifier: Apache-2.0
// SPDX-FileCopyrightText: 2026 Rodolfo Carrillo

import type { OcppVersion } from '@ocpptools/core';

import type { PayloadKind, SchemaRegistry } from './types.js';

const ACTION = /^[A-Za-z0-9]+$/;

/**
 * The file name the official schema packages use for the schema of an action.
 * OCPP 1.6J: `Action.json` and `ActionResponse.json`. OCPP 2.0.1:
 * `ActionRequest.json` and `ActionResponse.json`. Returns `undefined` when
 * `action` is not made of letters and digits, so it can never point outside a
 * directory of schemas.
 */
export function schemaFileName(
	version: OcppVersion,
	action: string,
	kind: PayloadKind,
): string | undefined {
	if (!ACTION.test(action)) {
		return undefined;
	}
	if (kind === 'response') {
		return `${action}Response.json`;
	}
	return version === '1.6' ? `${action}.json` : `${action}Request.json`;
}

/** The schema file exists, but `load` failed to provide it. */
export class SchemaLoadError extends Error {
	readonly fileName: string;

	constructor(fileName: string, cause: unknown) {
		super(`Could not load the schema ${fileName}`, { cause });
		this.name = 'SchemaLoadError';
		this.fileName = fileName;
	}
}

export interface SchemaRegistryOptions {
	readonly version: OcppVersion;
	/**
	 * Provides the schema stored in a file, or a promise of it. It must return
	 * the schema itself: a dynamic `import()` of a JSON file resolves to a module,
	 * so use `.then((module) => module.default)`. A module namespace is rejected
	 * as an invalid schema. It may return `undefined` when there is no such file.
	 */
	readonly load: (fileName: string) => unknown;
	/**
	 * The files that exist. A name outside the list is an unknown action and
	 * `load` is not called. Each entry is a file name such as
	 * `BootNotificationRequest.json`, or that name after the version and a slash,
	 * such as `2.0.1/BootNotificationRequest.json`, which is how the `manifest.json`
	 * of `@ocpptools/schemas` writes it. Without this option, `load` decides.
	 */
	readonly files?: Iterable<string>;
}

/**
 * Builds a registry on top of a function that loads schema files. Each file is
 * loaded once; a failed load is not remembered, so the next call tries again.
 * It knows no schema and no action, so it adds nothing to a bundle.
 */
export function createSchemaRegistry(options: SchemaRegistryOptions): SchemaRegistry {
	const { version, load } = options;
	const files = options.files === undefined ? undefined : new Set(options.files);
	const loading = new Map<string, Promise<unknown>>();

	const exists = (fileName: string): boolean =>
		files === undefined || files.has(fileName) || files.has(`${version}/${fileName}`);

	const loadFile = async (fileName: string): Promise<unknown> => {
		try {
			return await load(fileName);
		} catch (error) {
			throw new SchemaLoadError(fileName, error);
		}
	};

	return {
		get(action, kind) {
			const fileName = schemaFileName(version, action, kind);
			if (fileName === undefined || !exists(fileName)) {
				return undefined;
			}
			const known = loading.get(fileName);
			if (known !== undefined) {
				return known;
			}
			const schema = loadFile(fileName);
			loading.set(fileName, schema);
			// Forget a failed load, so the next call tries again. This runs after the
			// promise is stored, also when `load` throws before returning.
			schema.catch(() => {
				loading.delete(fileName);
			});
			return schema;
		},
	};
}
