# Simulator engine

Factories, the injected environment, the connection lifecycle, state, events, and errors of `@ocpptools/simulator`.

Back to the [simulator reference](README.md) · [package README](../../../packages/simulator/README.md)

## Factories

```ts
import { createSimulator } from '@ocpptools/simulator';

const simulator = createSimulator({
  version: '2.0.1',
  url: 'wss://csms.example.com/CP001',
  transport,
  clock,
  station: {
    id: 'CP001',
    vendorName: 'Acme',
    model: 'AC-22',
    firmwareVersion: '2.0.0',
  },
});

const legacy = createSimulator({
  version: '1.6',
  url: 'wss://csms.example.com/CP002',
  transport,
  clock,
  station: {
    id: 'CP002',
    vendor: 'Acme',
    model: 'AC-7',
    firmwareVersion: '1.0.0',
  },
});
```

`createSimulator16(options)` and `createSimulator201(options)` are also
available from their subpaths. The `Simulator16` and `Simulator201` classes
remain public.

Grouped sub-APIs expose the existing flows without duplicating state. OCPP
1.6 provides `transactions`, `localAuth`, `reservations`, `chargingProfiles`,
and `availability`. OCPP 2.0.1 adds `deviceModel`, `monitoring`, `display`,
`certificates`, `firmware`, and `customer`. Engine aliases include
`getPendingCalls`, `clearPendingCalls`, `getQueueLength`, `clearQueue`,
`clearHistory`, `resetMetrics`, and `setReconnectOptions`.

## Injectable environment

The profile classes require:

- `transport`: a `TransportFactory` from `@ocpptools/core`. A new transport is
  created for every connection attempt and is never reused.
- `clock`: a `Clock` from `@ocpptools/core`. The scheduler never uses ambient
  timers.

Optional:

- `messageIds`: a `MessageIdGenerator`.
- `random`: a deterministic source for lab features.

The browser entry provides `createWebStorage(localStorage)` for consumers that
wire their own persistence. The Node entry provides `createMemoryStorage()` and
`createFileStorage(directory)`, which stores one SHA-256-named file per key and
writes atomically.

## Lifecycle

- `connect()` and `disconnect()` control the transport.
- `isReady` means the transport is open and, when boot is required, the
  `BootNotification` was accepted.
- Pending boot retries; rejected boot does not start heartbeat or status loops.
- The offline queue is FIFO, bounded, and flushed after ready. BootNotification
  and Heartbeat are never queued.
- Calls settle exactly once by result, CALLERROR, timeout, disconnect, send
  failure, or dispose.
- `dispose()` cancels timers and rejects pending calls.

## State and events

`getState()` returns a deep copy of the version state plus connection, boot,
queue, metrics, clock offset, faults, validation mode, and inbound response
mode. State is JSON-serializable.

Events are a discriminated union: `connection`, `frame`, `log`, `pending`,
`queue`, `boot`, `heartbeat`, `connector`, `evse`, `transaction`,
`reservation`, `metrics`, `notice`, `fault`, `validation`, `scenario`, and
`error`. Use `on(type, listener)`, `onAny(listener)`, or the methods exposed by
the profile.

```ts
const unsubscribe = simulator.on('error', (event) => {
  console.error(event.error.code, event.error.message);
});
unsubscribe();
```

`getHistory()` returns the bounded protocol history. `getMetrics()` returns
round-trip statistics per action, heartbeat drift, and the last minute's error
count.

## Errors

`SimulatorError` codes describe local failures (`not-ready`, `timeout`,
`call-error`, `send-failed`, `invalid-options`, and others).
`SimulatorCallError` carries the OCPP error code, description, and details.
Package errors and OCPP wire errors are separate; 1.6 and 2.0.1 error-code sets
are never merged.
