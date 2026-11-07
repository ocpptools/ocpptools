// SPDX-License-Identifier: Apache-2.0
// SPDX-FileCopyrightText: 2026 Rodolfo Carrillo

/** The package name, used by smoke tests while the protocol is built. */
export const SIMULATOR_NAME = '@ocpptools/simulator';

export { Scheduler } from './clock.js';
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
export type { CallContext, CallHandler, PendingCall, RpcOptions } from './rpc.js';
