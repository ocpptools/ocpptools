// SPDX-License-Identifier: Apache-2.0
// SPDX-FileCopyrightText: 2026 Rodolfo Carrillo

export { OCPP_ERROR_CODES, isErrorCode } from './error-codes.js';
export type { OcppErrorCode } from './error-codes.js';
export { MESSAGE_TYPE, isCall, isCallError, isCallResult } from './frame.js';
export type {
	CallErrorFrame,
	CallFrame,
	CallResultFrame,
	MessageId,
	MessageType,
	OcppFrame,
} from './frame.js';
export type { JsonObject, JsonPrimitive, JsonValue } from './json.js';
export { OCPP_SUBPROTOCOLS, OCPP_VERSIONS } from './version.js';
export type { OcppSubprotocol, OcppVersion } from './version.js';
