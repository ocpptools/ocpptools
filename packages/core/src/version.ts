// SPDX-License-Identifier: Apache-2.0
// SPDX-FileCopyrightText: 2026 Rodolfo Carrillo

/** The OCPP-J versions this package supports. */
export const OCPP_VERSIONS = ['1.6', '2.0.1'] as const;

export type OcppVersion = (typeof OCPP_VERSIONS)[number];

/** Whether a value is one of the OCPP versions this package supports. */
export function isOcppVersion(value: unknown): value is OcppVersion {
	return typeof value === 'string' && (OCPP_VERSIONS as readonly string[]).includes(value);
}

/** WebSocket subprotocol name negotiated for each OCPP version. */
export const OCPP_SUBPROTOCOLS = {
	'1.6': 'ocpp1.6',
	'2.0.1': 'ocpp2.0.1',
} as const satisfies Record<OcppVersion, string>;

export type OcppSubprotocol = (typeof OCPP_SUBPROTOCOLS)[OcppVersion];
