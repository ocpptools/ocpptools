// SPDX-License-Identifier: Apache-2.0
// SPDX-FileCopyrightText: 2026 Rodolfo Carrillo

/** A JSON primitive. */
export type JsonPrimitive = string | number | boolean | null;

/** Any value that survives a `JSON.stringify` and `JSON.parse` round trip. */
export type JsonValue = JsonPrimitive | JsonValue[] | { [key: string]: JsonValue };

/** A JSON object. OCPP-J payloads and error details are always JSON objects. */
export type JsonObject = { [key: string]: JsonValue };
