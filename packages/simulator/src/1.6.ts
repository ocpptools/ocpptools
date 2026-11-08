// SPDX-License-Identifier: Apache-2.0
// SPDX-FileCopyrightText: 2026 Rodolfo Carrillo

export { SIMULATOR_NAME } from './index.js';
export { Simulator16 } from './profiles/1.6/index.js';
export type {
	ActiveTransaction16,
	CompletedTransaction16,
	Connector16,
	ConnectorStatus16,
	LocalAuthorizationEntry,
	Reservation16,
	Simulator16Options,
	Simulator16State,
	Station16Options,
} from './profiles/1.6/index.js';

/** The OCPP version of this entrypoint. */
export const SIMULATOR_PROTOCOL_VERSION = '1.6' as const;
