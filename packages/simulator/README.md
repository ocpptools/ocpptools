# @ocpptools/simulator

Headless OCPP 1.6J and 2.0.1 charge point simulator with injectable transports,
clock, and storage. It runs in the browser or in Node without a DOM in the
protocol engine.

> **Status:** alpha. APIs are unstable until 1.0.0.

OCPP is a specification of the Open Charge Alliance. This project is not
affiliated with, endorsed by, or certified by the Open Charge Alliance.

## Install

```sh
npm install @ocpptools/simulator @ocpptools/core
```

The package is ESM-only and requires Node >= 22.12 when used outside the
browser.

## Entrypoints

| Entrypoint                     | Contents                                                                |
| ------------------------------ | ----------------------------------------------------------------------- |
| `@ocpptools/simulator`         | Engine primitives and the version-agnostic `createSimulator` factory    |
| `@ocpptools/simulator/1.6`     | `Simulator16`, `createSimulator16`, the 1.6J profile and state types    |
| `@ocpptools/simulator/2.0.1`   | `Simulator201`, `createSimulator201`, the 2.0.1 profile and state types |
| `@ocpptools/simulator/browser` | WebSocket transport factory, browser clock, Web Storage adapter         |

The version subpaths fix the protocol version. Importing any runtime symbol
from the root loads both profile modules because the root exports the
`createSimulator` factory; use a version subpath to load only one protocol. The
browser entry contains no protocol profile and the engine entries contain no
DOM code.

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

## Browser quick start

```ts
import { createWebSocketTransportFactory, browserClock } from '@ocpptools/simulator/browser';
import { Simulator201 } from '@ocpptools/simulator/2.0.1';

const simulator = new Simulator201({
  url: 'wss://csms.example.com/CP001',
  transport: createWebSocketTransportFactory(),
  clock: browserClock,
  station: {
    id: 'CP001',
    vendorName: 'Acme',
    model: 'AC-22',
    firmwareVersion: '2.0.0',
    evseCount: 2,
    defaultIdToken: 'AABBCCDD',
    defaultChargingPowerKw: 7.4,
  },
});

simulator.on('transaction', (event) => {
  console.log(event.phase, event.transactionId);
});

simulator.connect();
```

With OCPP 1.6, import `Simulator16` from `@ocpptools/simulator/1.6` and use
`station: { id, vendor, model, firmwareVersion, connectorCount }`.

## Injectable environment

The profile classes require:

- `transport`: a `TransportFactory` from `@ocpptools/core`. A new transport is
  created for every connection attempt and is never reused.
- `clock`: a `Clock` from `@ocpptools/core`. The scheduler never uses ambient
  timers.

Optional:

- `messageIds`: a `MessageIdGenerator`.
- `random`: a deterministic source for lab features.

The browser entry also provides `createWebStorage(localStorage)` for consumers
that wire their own persistence.

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

## OCPP 1.6J

`Simulator16` models connectors, status notifications, authorization,
transactions, meter values, reservations, local authorization, diagnostics,
firmware status, data transfer, and the 19 CSMS commands. Connector state is
serializable and survives reconnects.

```ts
const started = await simulator16.startChargingSession(1, 'AABBCCDD');
await simulator16.stopTransaction(1, 'Local');
```

The profile keeps the full 1.6 action surface: 9 charge-point actions and 19
CSMS commands.

## OCPP 2.0.1

`Simulator201` models EVSE state, device variables, monitoring, local
authorization, reservations, charging profiles, displays, customer and cost
information, firmware, logs, certificates, and security events. All 64 actions
are handled:

- 25 charge-point-to-CSMS actions, including `TransactionEvent`, meter values,
  reports, reservations, charging limits, firmware and log status, certificates,
  and security events.
- 39 CSMS-to-charge-point actions, plus the bidirectional `DataTransfer`
  handler.

The advanced features use simulated state. Certificates are in-memory records
without ASN.1 parsing, WebCrypto, or real 15118 exchanges. Firmware and logs are
state machines, not real flashing or uploads. Monitoring thresholds and
composite schedules are calculated from stored state. No feature claims
conformance evidence.

### Transactions

```ts
const started = await simulator.startChargingSession(1, 'AABBCCDD');
await simulator.stopTransaction(1, 'Local');

simulator.rpc.handleText(
  JSON.stringify([
    2,
    'in-1',
    'RequestStartTransaction',
    {
      remoteStartId: 1,
      idToken: { idToken: 'AABBCCDD', type: 'ISO14443' },
    },
  ]),
);
```

`TransactionEvent` carries `seqNo`, `transactionInfo`, EVSE, idToken, optional
meter values, and `reservationId` only on the first `Started` event. Sequence
numbers advance only after a send or queue succeeds.

### Device model and monitoring

`SetVariables`, `GetVariables`, `GetBaseReport`, `GetReport`, `SetVariableMonitoring`,
`ClearVariableMonitoring`, `SetMonitoringBase`, and `SetMonitoringLevel` use
serializable device state. Reports are queued before boot and return
`EmptyResultSet` instead of an empty required array.

### Local authorization and reservations

`SendLocalList` supports Full and Differential updates. Local accepted entries
authorize without a CSMS call; blocked or expired entries fall back to
`Authorize` when online. Reservations enforce the token or group, are consumed
by starts, expire with the injected clock, and are cancelled when an EVSE
becomes unavailable or faulted.

### Charging profiles

`SetChargingProfile`, `ClearChargingProfile`, `GetChargingProfiles`, and
`GetCompositeSchedule` store profiles by EVSE and support the station-wide slot 0. Composite schedules honor validity, schedule duration, start times, stack
level per purpose, `TxProfile` precedence, and W/A conversion. `TxProfile`
requires an active matching transaction and is removed when it ends.

### Displays, customer, firmware, and logs

Display messages support priorities, states, and transaction-scoped cleanup.
Customer information accepts token, identifier, or certificate selectors.
Firmware update honors retrieve and install times and emits status
notifications. Log upload emits `LogStatusNotification`.

### Certificates and security

`InstallCertificate`, `DeleteCertificate`, `GetInstalledCertificateIds`, and
`CertificateSigned` store simulated certificate records. `SignCertificate`,
`Get15118EVCertificate`, `GetCertificateStatus`, and `SecurityEventNotification`
are available on the public API.

## Lab controls

`setFaults()`, `setValidationMode()`, and `setInboundResponseMode()` expose the
lab configuration. Inbound `reject` mode returns schema-valid rejections for the
status-shaped commands. The package does not depend on Ajv or the OCA schemas.

## Errors

`SimulatorError` codes describe local failures (`not-ready`, `timeout`,
`call-error`, `send-failed`, `invalid-options`, and others).
`SimulatorCallError` carries the OCPP error code, description, and details.
Package errors and OCPP wire errors are separate; 1.6 and 2.0.1 error-code sets
are never merged.

## Limits

- No Node transport in this package. It comes with the CLI.
- No real cryptography, 15118 stack, firmware flashing, or log upload.
- No hardware model or physical connector tree.
- The browser adapter uses the injected `WebSocket`; it does not retry by
  itself. Reconnection belongs to the engine.
- `storage` is optional and the caller owns persistence policy and secrets such
  as credentials in URLs.

## License

Apache-2.0. See the repository `LICENSE` and `NOTICE`. The OCA JSON Schemas are
not part of this package. The project is independent from the Open Charge
Alliance.
