// SPDX-License-Identifier: Apache-2.0
// SPDX-FileCopyrightText: 2026 Rodolfo Carrillo

import type { OcppVersion } from './version.js';

/**
 * The CALLERROR error codes of each OCPP version. The sets differ and must not
 * be merged:
 *
 * - 1.6J spells `FormationViolation` and `OccurenceConstraintViolation` (sic).
 * - 2.0.1 renames the first to `FormatViolation`, corrects the spelling of the
 *   second to `OccurrenceConstraintViolation`, and adds `MessageTypeNotSupported`
 *   and `RpcFrameworkError`.
 */
export const OCPP_ERROR_CODES = {
	'1.6': [
		'NotImplemented',
		'NotSupported',
		'InternalError',
		'ProtocolError',
		'SecurityError',
		'FormationViolation',
		'PropertyConstraintViolation',
		'OccurenceConstraintViolation',
		'TypeConstraintViolation',
		'GenericError',
	],
	'2.0.1': [
		'FormatViolation',
		'GenericError',
		'InternalError',
		'MessageTypeNotSupported',
		'NotImplemented',
		'NotSupported',
		'OccurrenceConstraintViolation',
		'PropertyConstraintViolation',
		'ProtocolError',
		'RpcFrameworkError',
		'SecurityError',
		'TypeConstraintViolation',
	],
} as const satisfies Record<OcppVersion, readonly string[]>;

/** The error codes defined for one OCPP version, or for either when omitted. */
export type OcppErrorCode<Version extends OcppVersion = OcppVersion> =
	(typeof OCPP_ERROR_CODES)[Version][number];

/**
 * Whether `code` is an error code defined for `version`. A peer can send a code
 * outside the set, so frame parsing does not reject unknown codes; use this to
 * check them.
 */
export function isErrorCode<Version extends OcppVersion>(
	version: Version,
	code: unknown,
): code is OcppErrorCode<Version> {
	return (
		typeof code === 'string' && (OCPP_ERROR_CODES[version] as readonly string[]).includes(code)
	);
}
