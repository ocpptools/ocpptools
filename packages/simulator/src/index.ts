// SPDX-License-Identifier: Apache-2.0
// SPDX-FileCopyrightText: 2026 Rodolfo Carrillo

export { SIMULATOR_NAME } from './name.js';

export { createSimulator } from './factory.js';
export type { CreateSimulatorOptions } from './factory.js';
export { runScenario, scenarioEntityId, scenarioIdToken } from './scenario.js';
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
export { Scheduler } from './clock.js';
export { EngineBase } from './engine.js';
export type { BootResponse, EngineProfile, EngineState } from './engine.js';
export { Metrics } from './metrics.js';
export type { RttStat, SimulatorMetrics } from './metrics.js';
export type {
	BootOptions,
	BootSnapshot,
	BootStatus,
	CommonSimulatorOptions,
	FaultConfig,
	PersistenceOptions,
	SimulatorConfig,
	SimulatorStateBase,
	TimingOptions,
} from './state.js';
export type {
	LoadResult,
	RestoreResult,
	SaveResult,
	SimulatorPersistedConfig,
	SimulatorSnapshot,
} from './persistence.js';
export { Connection } from './connection.js';
export type { ConnectionOptions, ConnectionSnapshot, ReconnectOptions } from './connection.js';
export { OfflineQueue } from './queue.js';
export type { FlushResult, QueueOptions, QueueSnapshot, QueuedCall } from './queue.js';
export {
	SimulatorCallError,
	SimulatorError,
	SimulatorValidationError,
	errorSnapshot,
} from './errors.js';
export type { SimulatorErrorCode, SimulatorErrorSnapshot } from './errors.js';
export { EventEmitter } from './events.js';
export type {
	BootEvent,
	ConnectionEvent,
	ConnectionReason,
	ConnectionState,
	ConnectorEvent,
	ErrorEvent,
	EvseEvent,
	EventListener,
	FaultEvent,
	FrameEvent,
	HeartbeatEvent,
	InboundResponseMode,
	LogEvent,
	MessageDirection,
	MetricsEvent,
	NoticeEvent,
	NoticeLevel,
	PendingEvent,
	QueueEvent,
	ReservationEvent,
	ScenarioEvent,
	SimulatorEvent,
	TransactionEvent,
	Unsubscribe,
	ValidateMode,
	ValidationEvent,
} from './events.js';
export { History } from './log.js';
export type { LogDirection, LogLevel, LogMessageType, SimulatorLogEntry } from './log.js';
export { defaultRandom } from './random.js';
export type { RandomSource } from './random.js';
export { Rpc } from './rpc.js';
export type {
	CertificateHashData201,
	CertificatePurpose201,
	CertificateSummary201,
	CertificateValidationContext201,
	CertificateValidationResult201,
	CsrProvider201,
	FirmwareVerifier201,
	Iso15118Codec201,
	RevocationChecker201,
	SecurityOptions201,
	SecurityTrustStore201,
	SignWithProviderInput201,
	SignWithProviderResult201,
} from './profiles/2.0.1/security.js';
export type { CallContext, CallHandler, PendingCall, RpcOptions } from './rpc.js';
