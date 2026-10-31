// SPDX-License-Identifier: Apache-2.0
// SPDX-FileCopyrightText: 2026 Rodolfo Carrillo

/**
 * The outcome of a function that can fail because of its input. Boundary
 * functions return a result instead of throwing, so check `ok` before using
 * `value`.
 */
export type Result<Value, Failure> =
	{ readonly ok: true; readonly value: Value } | { readonly ok: false; readonly error: Failure };
