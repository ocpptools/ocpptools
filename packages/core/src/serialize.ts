// SPDX-License-Identifier: Apache-2.0
// SPDX-FileCopyrightText: 2026 Rodolfo Carrillo

import type { OcppFrame } from './frame.js';
import { parseFrame } from './parse.js';
import type { Result } from './result.js';

/**
 * Why a frame was not serialized:
 *
 * - `invalid-frame`: the value is not a well-formed OCPP-J frame.
 * - `unserializable`: a value inside the frame has no JSON form (`undefined`,
 *   a function, a symbol, a BigInt, `NaN`, `Infinity`, or a circular reference),
 *   or a `toJSON` method threw.
 */
export type SerializeFrameErrorKind = 'invalid-frame' | 'unserializable';

export interface SerializeFrameError {
	readonly kind: SerializeFrameErrorKind;
	readonly message: string;
}

function fail(kind: SerializeFrameErrorKind, message: string): Result<never, SerializeFrameError> {
	return { ok: false, error: { kind, message } };
}

// `JSON.stringify` silently turns `undefined`, functions, symbols, `NaN`, and
// `Infinity` into `null` or drops them. Reject them so a frame is never changed
// on its way to the wire.
function rejectLossyValues(key: string, value: unknown): unknown {
	const where = key === '' ? 'the frame' : `"${key}"`;
	switch (typeof value) {
		case 'undefined':
		case 'function':
		case 'symbol':
		case 'bigint':
			throw new TypeError(`${where} is ${typeof value}, which JSON cannot represent`);
		case 'number':
			if (!Number.isFinite(value)) {
				throw new TypeError(`${where} is a non-finite number, which JSON cannot represent`);
			}
			return value;
		default:
			return value;
	}
}

/**
 * Serializes an OCPP-J frame to compact JSON text. Array order is preserved and
 * object keys keep their insertion order. The output always parses back with
 * `parseFrame`, and it never throws.
 */
export function serializeFrame(frame: OcppFrame): Result<string, SerializeFrameError> {
	let text: string;
	try {
		text = JSON.stringify(frame, rejectLossyValues);
	} catch (error) {
		return fail(
			'unserializable',
			error instanceof Error ? error.message : 'Value cannot be serialized',
		);
	}
	const parsed = parseFrame(text);
	if (!parsed.ok) {
		return fail('invalid-frame', `Not a valid OCPP-J frame: ${parsed.error.message}`);
	}
	return { ok: true, value: text };
}
