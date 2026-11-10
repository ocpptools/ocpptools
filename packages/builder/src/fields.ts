// SPDX-License-Identifier: Apache-2.0
// SPDX-FileCopyrightText: 2026 Rodolfo Carrillo

import type { Field } from '@ocpptools/schema-utils';
import { getFields } from '@ocpptools/schema-utils';

import { messageOf, schemaInvalid } from './errors.js';
import type { SchemaLoader } from './schema.js';
import type { BuilderResult, FieldsOptions, PayloadKind } from './types.js';

export async function fieldsFor(
	loader: SchemaLoader,
	action: string,
	options: FieldsOptions = {},
): Promise<BuilderResult<Field>> {
	const kind: PayloadKind = options.kind ?? 'request';
	const loaded = await loader.load(action, kind);
	if (!loaded.ok) return loaded;
	let tree: Field;
	try {
		tree =
			options.omit === undefined
				? getFields(loaded.value.schema)
				: getFields(loaded.value.schema, { omit: options.omit });
	} catch (error) {
		return {
			ok: false,
			error: schemaInvalid(messageOf(error, 'The schema fields could not be described')),
			warnings: loaded.warnings,
		};
	}
	return { ok: true, value: tree, warnings: loaded.warnings };
}
