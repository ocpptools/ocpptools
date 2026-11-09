// SPDX-License-Identifier: Apache-2.0
// SPDX-FileCopyrightText: 2026 Rodolfo Carrillo

import { readFileSync } from 'node:fs';
import { createRequire } from 'node:module';

import type { OcppVersion } from '@ocpptools/core';
import {
	createSchemaRegistry,
	createValidator,
	type SchemaRegistry,
	type Validator,
} from '@ocpptools/validator';

interface SchemaManifest {
	readonly files?: unknown;
}

const require = createRequire(import.meta.url);

function schemaFiles(version: OcppVersion): readonly string[] {
	const manifest = JSON.parse(
		readFileSync(require.resolve('@ocpptools/schemas/manifest.json'), 'utf8'),
	) as SchemaManifest;
	const files = manifest.files;
	if (typeof files !== 'object' || files === null || Array.isArray(files)) {
		throw new Error('The @ocpptools/schemas manifest has no files');
	}
	const prefix = `${version}/`;
	return Object.keys(files)
		.filter((path) => path.startsWith(prefix))
		.map((path) => path.slice(prefix.length));
}

/**
 * A registry backed by the files of `@ocpptools/schemas` for one version. The
 * manifest lists the files, so an unknown action is not mistaken for a failed
 * load. Each schema is read the first time its action is validated.
 */
export function createCliSchemaRegistry(version: OcppVersion): SchemaRegistry {
	return createSchemaRegistry({
		version,
		files: schemaFiles(version),
		load: (fileName) => {
			const path = require.resolve(`@ocpptools/schemas/${version}/${fileName}`);
			return JSON.parse(readFileSync(path, 'utf8')) as unknown;
		},
	});
}

/** Creates a validator that loads the official schemas of `version`. */
export function createCliValidator(version: OcppVersion): Validator {
	return createValidator({ version, schemas: createCliSchemaRegistry(version) });
}
