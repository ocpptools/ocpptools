// SPDX-License-Identifier: Apache-2.0
// SPDX-FileCopyrightText: 2026 Rodolfo Carrillo

import { Ajv } from 'ajv';
import addFormatsModule from 'ajv-formats';

const addFormats = addFormatsModule as unknown as (ajv: Ajv) => Ajv;

/**
 * Creates the Ajv instance of a validator. `strictSchema` is off because the
 * OCPP 2.0.1 schemas use `additionalItems` next to a single `items` schema. The
 * other strict checks keep their defaults: they log through `logger`, which is
 * off, so the OCPP schemas compile. `multipleOfPrecision` keeps decimal
 * `multipleOf` values from failing because of floating point. Only own
 * properties count, so `toString` or `__proto__` cannot satisfy a required
 * field. The instance never coerces values or inserts defaults.
 */
export function createAjv(): Ajv {
	const ajv = new Ajv({
		addUsedSchema: false,
		allErrors: true,
		logger: false,
		multipleOfPrecision: 6,
		ownProperties: true,
		strictSchema: false,
	});
	addFormats(ajv);
	return ajv;
}
