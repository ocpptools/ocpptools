// SPDX-License-Identifier: Apache-2.0
// SPDX-FileCopyrightText: 2026 Rodolfo Carrillo

import { readFileSync, readdirSync } from 'node:fs';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';

import type { OcppVersion } from '@ocpptools/core';
import {
	createSchemaRegistry,
	createValidator,
	type Validator,
} from '../../../validator/src/index.js';

const schemaRoot = fileURLToPath(new URL('../../../schemas/schemas', import.meta.url));
const validators = new Map<OcppVersion, Validator>();

/** Builds one local validator per version, loading the OCA copies read-only. */
export function schemaValidator(version: OcppVersion): Validator {
	const existing = validators.get(version);
	if (existing !== undefined) return existing;
	const directory = join(schemaRoot, version);
	const registry = createSchemaRegistry({
		version,
		files: readdirSync(directory),
		load: (fileName) => JSON.parse(readFileSync(join(directory, fileName), 'utf8')) as unknown,
	});
	const validator = createValidator({ version, schemas: registry });
	validators.set(version, validator);
	return validator;
}

export async function expectSchemaValid(
	version: OcppVersion,
	frame: unknown,
	requestAction?: string,
): Promise<void> {
	const result = await schemaValidator(version).validateFrame(
		frame,
		requestAction === undefined ? {} : { requestAction },
	);
	if (result.status !== 'valid') {
		throw new Error(`${version} frame is ${result.status}: ${JSON.stringify(result.issues)}`);
	}
}
