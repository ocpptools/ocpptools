# Unit-test OCPP code without a network

`@ocpptools/testing` provides a mock CSMS, an in-memory transport, frame
factories, and a fake clock. Together they let you test OCPP code in
milliseconds, deterministically, without sockets or real timers.

![Vitest runs the two tests of this guide, which use the mock CSMS and the in-memory transport; both pass in milliseconds.](../assets/testing-vitest.gif)

Also available as [video](../assets/testing-vitest.mp4). The recorded test file
is [`station.test.mjs`](../../scripts/demos/terminal/fixtures/station.test.mjs).

```sh
npm install @ocpptools/testing --save-dev
```

The samples use [Vitest](https://vitest.dev/), but any test runner works.

## Test a charging station client

Connect your client, or the simulator, to the mock CSMS through an in-memory
transport pair. The mock only answers actions you give it a handler for.

```ts
import { createSimulator16 } from '@ocpptools/simulator/1.6';
import {
  createFakeClock,
  createInMemoryTransportPair,
  createMockCsms,
  flushMicrotasks,
} from '@ocpptools/testing';
import { expect, it } from 'vitest';

it('boots and sends a heartbeat', async () => {
  const clock = createFakeClock();
  const pair = createInMemoryTransportPair();
  const csms = createMockCsms({
    version: '1.6',
    transport: pair.server,
    handlers: {
      BootNotification: () => ({
        status: 'Accepted',
        currentTime: '2026-01-01T00:00:00Z',
        interval: 60,
      }),
      StatusNotification: () => ({}),
      Heartbeat: () => ({ currentTime: '2026-01-01T00:01:00Z' }),
    },
  });
  const simulator = createSimulator16({
    url: 'ws://in-memory/CP-1',
    transport: () => pair.client,
    clock,
    station: { id: 'CP-1', vendor: 'Acme', model: 'AC-7', firmwareVersion: '1.0.0' },
  });

  simulator.connect();
  pair.link.open();
  for (let attempt = 0; attempt < 20 && !simulator.isReady; attempt += 1) {
    await flushMicrotasks(5);
  }
  expect(simulator.isReady).toBe(true);

  await simulator.sendHeartbeat();
  await csms.waitForIdle();

  const actions = csms.calls.map((call) => call[2]);
  expect(actions[0]).toBe('BootNotification');
  expect(actions).toContain('Heartbeat');
  simulator.dispose();
});
```

## Test a CSMS handler

Send frames from the client side of the pair and inspect what the server side
receives. The frame factory builds CALL, CALLRESULT, and CALLERROR frames with
predictable message IDs (`msg-1`, `msg-2`, …):

```ts
import {
  createFrameFactory,
  createInMemoryTransportPair,
  createMockCsms,
} from '@ocpptools/testing';

const pair = createInMemoryTransportPair();
const csms = createMockCsms({
  version: '2.0.1',
  transport: pair.server,
  handlers: { Heartbeat: () => ({ currentTime: '2026-01-01T00:00:00Z' }) },
});
const frames = createFrameFactory({ version: '2.0.1' });

pair.link.open();
pair.client.send(JSON.stringify(frames.call('Heartbeat', {})));
await pair.link.flush();
await csms.waitForIdle();

// csms.calls, csms.results, and csms.errors hold the session.
```

To test your own CSMS code, connect it to `pair.server` instead of the mock.

## Control time

`createFakeClock()` implements the `Clock` interface without real time.
`clock.advance(ms)` runs due timers in order, so heartbeats, meter values, and
timeouts happen on demand:

```ts
clock.advance(60_000); // one heartbeat interval later
await flushMicrotasks();
```

## Simulate network problems

The in-memory link can drop, fail, or close the connection:

- `pair.link.dropNext('client-to-server')` drops the next frame that is already
  queued in that direction. Call it after the `send()` and before delivery; it
  returns `false` when nothing is queued.
- `pair.link.failNext(direction, error)` makes the next `send()` throw.
- `pair.link.fail(error)` closes the connection with code 1006.

For reconnection tests, use `createInMemoryTransportHub()`. Pass `hub.factory`
as the `transport` option; it creates one pair per connection attempt. The pairs
are not opened automatically: get each one with `await hub.nextPair()` and open
it with `link.open()`.

See the [testing README](../../packages/testing/README.md) for every option and
limit.
