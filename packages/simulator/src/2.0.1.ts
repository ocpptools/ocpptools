// SPDX-License-Identifier: Apache-2.0
// SPDX-FileCopyrightText: 2026 Rodolfo Carrillo

export { SIMULATOR_NAME } from './name.js';
import { Simulator201 } from './profiles/2.0.1/index.js';
import type { Simulator201Options } from './profiles/2.0.1/index.js';
export { Simulator201 } from './profiles/2.0.1/index.js';
export function createSimulator201(options: Simulator201Options): Simulator201 {
	return new Simulator201(options);
}
export { sendNotifyMonitoringReport201, sendNotifyReport201 } from './profiles/2.0.1/index.js';
export type {
	NotifyMonitoringReportOptions201,
	NotifyReportOptions201,
} from './profiles/2.0.1/index.js';
export type {
	ActiveTransaction201,
	AvailabilityApi201,
	CertificatesApi201,
	ChargingProfilesApi201,
	ChargingState201,
	CompletedTransaction201,
	CustomerApi201,
	DeviceModelApi201,
	DisplayApi201,
	Evse201,
	EvseStatus201,
	FirmwareApi201,
	IdTokenKind201,
	LocalAuthApi201,
	MonitoringApi201,
	PendingResets201,
	ReservationsApi201,
	Simulator201Options,
	Simulator201State,
	Station201Options,
	TransactionsApi201,
} from './profiles/2.0.1/index.js';
export type {
	MonitoringBase201,
	MonitoringState201,
	MonitorType201,
	NetworkProfile201,
	VariableMonitor201,
} from './profiles/2.0.1/device-model.js';
export type {
	LocalAuthorizationEntry201,
	LocalAuthorizationState201,
	Reservation201,
} from './profiles/2.0.1/local-auth.js';
export type { ChargingProfile201, ChargingProfileState201 } from './profiles/2.0.1/charging.js';
export type { DisplayMessage201, ServicesState201 } from './profiles/2.0.1/services.js';
export type { SecurityState201, SimulatedCertificate201 } from './profiles/2.0.1/security.js';

/** The OCPP version of this entrypoint. */
export const SIMULATOR_PROTOCOL_VERSION = '2.0.1' as const;
