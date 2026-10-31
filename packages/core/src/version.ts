// SPDX-License-Identifier: Apache-2.0
// SPDX-FileCopyrightText: 2026 Rodolfo Carrillo

/** The OCPP-J versions this package supports. */
export const OCPP_VERSIONS = ['1.6', '2.0.1'] as const;

export type OcppVersion = (typeof OCPP_VERSIONS)[number];

/** WebSocket subprotocol name negotiated for each OCPP version. */
export const OCPP_SUBPROTOCOLS = {
	'1.6': 'ocpp1.6',
	'2.0.1': 'ocpp2.0.1',
} as const satisfies Record<OcppVersion, string>;

export type OcppSubprotocol = (typeof OCPP_SUBPROTOCOLS)[OcppVersion];
