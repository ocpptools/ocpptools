# @ocpptools/testing

Test doubles and deterministic helpers for OCPP 1.6J and 2.0.1.

> **Status:** alpha. APIs may change in any minor release before 1.0.0. See
> [ADR 0014](https://github.com/ocpptools/ocpptools/blob/main/docs/ADR/0014-testing-utilities.md)
> and [ADR 0015](https://github.com/ocpptools/ocpptools/blob/main/docs/ADR/0015-testing-publication-override.md).

## Install

```bash
npm install @ocpptools/testing
```

Requires Node.js 22.12 or newer. The package is ESM-only and also runs in the
browser.

The package provides a protocol-level mock CSMS, an in-memory transport, frame
factories, synthetic fixtures, and a deterministic fake clock. It is a test
utility, not a complete CSMS, a charge point, or a conformance tool.

OCPP is a specification of the Open Charge Alliance. This project is not
affiliated with, endorsed by, or certified by the Open Charge Alliance.

## What it does

- Connects a client and a server through the `Transport` contract from
  `@ocpptools/core`, without sockets or a network.
- Acts as a transport-agnostic mock CSMS for tests.
- Builds CALL, CALLRESULT, and CALLERROR frames with deterministic IDs.
- Provides synthetic fixtures, including invalid frames.
- Provides a deterministic fake clock and microtask flushing.
- Works in browsers and Node 22.12+ from the same root entry.

It does **not** include OCA schemas, action lists, per-action types, default OCPP
responses, Ajv, `ws`, DOM, Node built-ins, or a full CSMS state machine.

## Quick start

The action `Example` is synthetic. Your application supplies the real actions
and payloads in its tests.

```ts
import {
  createFrameFactory,
  createInMemoryTransportPair,
  createMockCsms,
} from '@ocpptools/testing';

const pair = createInMemoryTransportPair({ delivery: 'manual' });
const csms = createMockCsms({
  version: '2.0.1',
  transport: pair.server,
  handlers: {
    Example: () => ({ value: 'ok' }),
  },
});
const frames = createFrameFactory({ version: '2.0.1' });

pair.link.open();
pair.client.send(JSON.stringify(frames.call('Example', { value: 'hello' })));
await pair.link.flush();

console.log(csms.calls, csms.results);
```

## In-memory transport

`createInMemoryTransportPair()` returns `{ client, server, link, options }`.
Both endpoints implement `Transport`. The pair starts in `connecting`; call
`link.open()` to open both.

- `delivery: 'microtask'` (default) delivers automatically and `flush()` waits.
- `delivery: 'manual'` only delivers when `flush()` is called.
- `link.close()` and either endpoint's `close()` close both ends.
- `link.fail(error)` emits `onError` and closes with code 1006.
- `link.dropNext(direction)` drops the next queued frame.
- `link.failNext(direction, error)` makes the next `send()` throw.
- `maxQueue` (default 1024) and `maxFlushRounds` (default 1000) bound the work.

`createInMemoryTransportHub()` adds a `TransportFactory` for reconnection tests:

```ts
const hub = createInMemoryTransportHub();
const pair = hub.createPair();
// or: const client = hub.factory({ url: 'ws://in-memory/CP-1', subprotocol: 'ocpp1.6' });
//     const pair = await hub.nextPair();
```

`nextPair()` returns a factory-created pair before it opens when `autoOpen` is
false (the default). With `autoOpen: true`, the pair may already be open by the
time `nextPair()` resolves; attach listeners before creating it or use the
default.

## Mock CSMS

`createMockCsms()` receives a `Transport` and starts listening immediately.

- Handlers are a `Record<string, MockCsmsHandler>`; there are no built-ins.
- `autoRespond: 'handlers'` (default) answers only when a handler returns a
  payload. `autoRespond: 'empty'` answers `{}` to unknown actions.
- A handler may return a payload, return `undefined` to leave the CALL pending,
  or throw `MockCsmsCallError` to send CALLERROR.
- `await csms.waitForCall(action)` consumes the next unread CALL, including one
  received before the wait.
- `csms.respond(call, payload)` and `csms.reject(call, code, description)`
  answer a pending CALL manually.
- `csms.call(action, payload)` starts a server-initiated CALL and resolves with
  the peer's CALLRESULT or rejects with its CALLERROR.
- `rawReceived`, `rawSent`, `received`, `sent`, `calls`, `results`, `errors`,
  `pending`, and `issues` expose the session.
- `await csms.waitForIdle()` waits for async handlers, validators, and responses.

Only one responder may claim a CALL. If an async handler is still running,
`pending` includes the CALL but a manual `respond()` throws
`MockCsmsError('protocol')` until the handler releases it. `link.flush()` drains
the transport, not arbitrary handler promises; after sending to an async
handler, `await csms.waitForIdle()` waits for every in-flight handler, validator,
and response.

Malformed frames are recorded in `issues`. With `replyToInvalidFrames: true`,
the mock answers malformed CALLs and unknown message types, but never answers a
CALLRESULT or CALLERROR with a CALLERROR. A malformed response with a matching
pending ID rejects the server-initiated call instead of leaving it hanging.

## Frame factories

`createFrameFactory({ version?, messageIds? })` returns `call`, `callResult`,
and `callError`.

```ts
const frames = createFrameFactory({ version: '2.0.1' });
const call = frames.call('Example', { value: 'x' });
const result = frames.callResult(call, { value: 'ok' });
const error = frames.callError(call, 'InternalError', 'failed');
```

The default message IDs are `msg-1`, `msg-2`, and so on, per factory. Pass
`messageIds` to inject a generator. The factory rejects non-plain JSON values
(`Date`, `Map`, class instances, cycles, sparse arrays, accessors, symbols) and
validates the frame with `@ocpptools/core`. With `version`, CALLERROR codes are
checked against that version's set.

## Fixtures

`createSyntheticFixtures()` returns fresh values:

- `call()`, `callResult(call?)`, `callError(call?)`
- `payload()`
- `invalidFrames()`

The fixtures use only the synthetic action `Example` and generic JSON. They do
not contain OCA schema data or real action catalogues.

## Fake clock

`createFakeClock({ now? })` implements `Clock` without ambient time.

- `advance(ms)` runs timers in chronological order.
- `runAll()` runs every pending timer.
- `pendingTimers` reports the queue size.
- Both methods stop after 10 000 callbacks and throw `not-making-progress`.
- `flushMicrotasks(rounds?)` lets promise continuations run.

A callback that throws keeps `now` at that timer's time, leaves the target
unapplied, and leaves the remaining timers pending.

## Limits

- Plain JSON guard: depth 64, 10 000 nodes.
- In-memory queue: 1024 frames per direction.
- In-memory flush: 1000 rounds.
- Fake clock: 10 000 callbacks per `advance` or `runAll`.
- No ambient time, randomness, network, DOM, or Node built-ins.

These limits are intentionally conservative for tests. If you need a larger
value, add a consumer requirement and a new decision rather than bypassing the
guard.

## Integration

`@ocpptools/simulator`, `@ocpptools/validator`, and `@ocpptools/schemas` are
devDependencies of this package. The integration tests use them at runtime; none
is a dependency of the published tarball. See
[test/integration-simulator.test.ts](https://github.com/ocpptools/ocpptools/blob/main/packages/testing/test/integration-simulator.test.ts)
for a 1.6J and 2.0.1 flow over the in-memory transport. Real action names and
minimal payloads in that test are hand-written test data, not packaged fixtures.

## Legal

The package ships no OCA schema, schema copy, action list, per-action type, or
default response. Error codes come from `@ocpptools/core`; the 1.6J and 2.0.1
sets are not merged. The package is Apache-2.0 only and does not include
`LICENSE-CC-BY-ND-4.0.txt`.

## License

Apache-2.0. See the repository `LICENSE` and `NOTICE`.
