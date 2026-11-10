// SPDX-License-Identifier: Apache-2.0
// SPDX-FileCopyrightText: 2026 Rodolfo Carrillo

export { createFakeClock, flushMicrotasks } from './clock/fake-clock.js';
export type { FakeClock, FakeClockOptions } from './clock/fake-clock.js';

export {
	FakeClockError,
	FrameFactoryError,
	InMemoryTransportError,
	MockCsmsCallError,
	MockCsmsError,
} from './errors.js';
export type {
	FakeClockErrorCode,
	FrameFactoryErrorCode,
	FrameFactoryErrorOptions,
	InMemoryTransportErrorCode,
	MockCsmsCallErrorOptions,
	MockCsmsErrorCode,
	TestingErrorOptions,
} from './errors.js';

export { createMockCsms } from './csms/mock-csms.js';
export type {
	MockCsms,
	MockCsmsCallOptions,
	MockCsmsContext,
	MockCsmsHandler,
	MockCsmsIssue,
	MockCsmsIssueCode,
	MockCsmsOptions,
} from './csms/mock-csms.js';

export { createFrameFactory } from './frames/factory.js';
export type { FrameFactory, FrameFactoryOptions } from './frames/factory.js';

export { createSyntheticFixtures } from './frames/fixtures.js';
export type { SyntheticFixtures } from './frames/fixtures.js';

export { createInMemoryTransportHub, createInMemoryTransportPair } from './transport/in-memory.js';
export type {
	InMemoryDelivery,
	InMemoryDirection,
	InMemoryFrame,
	InMemoryTransport,
	InMemoryTransportHub,
	InMemoryTransportHubOptions,
	InMemoryTransportLink,
	InMemoryTransportOptions,
	InMemoryTransportPair,
	InMemoryTransportPairOptions,
} from './transport/in-memory.js';
