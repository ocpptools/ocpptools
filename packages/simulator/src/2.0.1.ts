// SPDX-License-Identifier: Apache-2.0
// SPDX-FileCopyrightText: 2026 Rodolfo Carrillo

export { SIMULATOR_NAME } from './index.js';
export { Simulator201 } from './profiles/2.0.1/index.js';
export type {
	ActiveTransaction201,
	ChargingState201,
	CompletedTransaction201,
	Evse201,
	EvseStatus201,
	IdTokenKind201,
	Simulator201Options,
	Simulator201State,
	Station201Options,
} from './profiles/2.0.1/index.js';

/** The OCPP version of this entrypoint. */
export const SIMULATOR_PROTOCOL_VERSION = '2.0.1' as const;
