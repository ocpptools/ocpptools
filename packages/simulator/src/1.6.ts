// SPDX-License-Identifier: Apache-2.0
// SPDX-FileCopyrightText: 2026 Rodolfo Carrillo

export { SIMULATOR_NAME } from './name.js';
export { runScenario, scenarioEntityId, scenarioIdToken } from './scenario.js';
export type {
	LoadResult,
	RestoreResult,
	SaveResult,
	SimulatorPersistedConfig,
	SimulatorSnapshot,
} from './persistence.js';
export type {
	ScenarioAdapter,
	ScenarioEngine,
	ScenarioOptions,
	ScenarioResult,
	ScenarioRun,
	ScenarioStatus,
	ScenarioStep,
	ScenarioStepResult,
	ScenarioStepStatus,
} from './scenario.js';
import { Simulator16 } from './profiles/1.6/index.js';
import type { Simulator16Options } from './profiles/1.6/index.js';
export { Simulator16 } from './profiles/1.6/index.js';
export function createSimulator16(options: Simulator16Options): Simulator16 {
	return new Simulator16(options);
}
export {
	startChargingSession,
	startTransaction,
	sendMeterValues,
	sendStatusNotification,
} from './profiles/1.6/index.js';
export type {
	ActiveTransaction16,
	CompletedTransaction16,
	Connector16,
	ConnectorStatus16,
	LocalAuthorizationEntry,
	Reservation16,
	Simulator16AvailabilityApi,
	Simulator16ChargingProfilesApi,
	Simulator16LocalAuthApi,
	Simulator16Options,
	Simulator16ReservationsApi,
	Simulator16State,
	Simulator16TransactionsApi,
	Station16Options,
} from './profiles/1.6/index.js';

/** The OCPP version of this entrypoint. */
export const SIMULATOR_PROTOCOL_VERSION = '1.6' as const;
