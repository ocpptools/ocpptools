# @ocpptools/simulator

Headless OCPP 1.6J and 2.0.1 charge point simulator with injectable transports, clock, and storage.

[![npm](https://img.shields.io/npm/v/@ocpptools/simulator)](https://www.npmjs.com/package/@ocpptools/simulator)
[![License](https://img.shields.io/npm/l/@ocpptools/simulator)](https://github.com/ocpptools/ocpptools/blob/main/LICENSE)

> **Status:** alpha. The API can change in any minor release before 1.0.0.

![A Node script connects a simulated OCPP 2.0.1 station to a CSMS, runs a boot, start, meter, and stop scenario, and prints each CALL it sends.](https://raw.githubusercontent.com/ocpptools/ocpptools/main/docs/assets/simulator-code.gif)

It runs in the browser or in Node without a DOM in the protocol engine. It
handles all 28 OCPP 1.6J actions and all 64 OCPP 2.0.1 actions, keeps
serializable state, and supports scenarios, persistence, fault injection, and
opt-in real cryptography.

## When to use it

- You build or test a CSMS and need charging stations that connect over
  WebSocket and behave like real ones: boot, status, authorization,
  transactions, meter values, and CSMS commands.
- You build a browser or Node tool that drives a simulated station.
- To run a scenario from the terminal without code, use the
  [`ocpptools` CLI](https://github.com/ocpptools/ocpptools/tree/main/packages/cli).
- For unit tests without a network, combine it with
  [`@ocpptools/testing`](https://github.com/ocpptools/ocpptools/tree/main/packages/testing).

## Install

```sh
npm install @ocpptools/simulator @ocpptools/core
```

The package is ESM-only and requires Node.js 22.12 or newer outside the
browser.

## Quick start

Connect an OCPP 2.0.1 charging station to a CSMS from Node:

```ts
import { createNodeWebSocketTransportFactory, nodeClock } from '@ocpptools/simulator/node';
import { Simulator201 } from '@ocpptools/simulator/2.0.1';

const simulator = new Simulator201({
  url: 'wss://csms.example.com/CP001',
  transport: createNodeWebSocketTransportFactory(),
  clock: nodeClock,
  station: {
    id: 'CP001',
    vendorName: 'Acme',
    model: 'AC-22',
    firmwareVersion: '2.0.0',
  },
});

simulator.connect();
```

The Node transport uses the built-in `WebSocket` of Node.js 22.12 or newer. For
OCPP 1.6J, import `Simulator16` from `@ocpptools/simulator/1.6` and use
`station: { id, vendor, model, firmwareVersion, connectorCount }`.

## Run in the browser

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

## Run a charging session

```ts
const started = await simulator.startChargingSession(1, 'AABBCCDD');
await simulator.stopTransaction(1, 'Local');
```

Or describe the steps as a scenario:

```ts
const run = simulator.runScenario([
  { type: 'start', entityId: 1, idToken: 'AABBCCDD' },
  { type: 'wait', ms: 5000 },
  { type: 'meter', entityId: 1 },
  { type: 'stop', entityId: 1 },
]);

const result = await run.done;
if (result.status !== 'completed') {
  console.error(result.error);
}
```

## Entrypoints

| Entrypoint                     | Contents                                                                |
| ------------------------------ | ----------------------------------------------------------------------- |
| `@ocpptools/simulator`         | Engine primitives and the version-agnostic `createSimulator` factory    |
| `@ocpptools/simulator/1.6`     | `Simulator16`, `createSimulator16`, the 1.6J profile and state types    |
| `@ocpptools/simulator/2.0.1`   | `Simulator201`, `createSimulator201`, the 2.0.1 profile and state types |
| `@ocpptools/simulator/browser` | WebSocket transport factory, browser clock, Web Storage adapter         |
| `@ocpptools/simulator/node`    | Node WebSocket transport factory, Node clock, memory and file storage   |

The version subpaths fix the protocol version. Importing any runtime symbol
from the root loads both profile modules because the root exports the
`createSimulator` factory; use a version subpath to load only one protocol. The
browser and Node entries contain no protocol profile, and the engine entries
contain no DOM or Node APIs.

## Reference

| Topic                                                                                                         | Covers                                                                           |
| ------------------------------------------------------------------------------------------------------------- | -------------------------------------------------------------------------------- |
| [Engine](https://github.com/ocpptools/ocpptools/blob/main/docs/reference/simulator/engine.md)                 | Factories, injected transport and clock, lifecycle, state, events, errors        |
| [OCPP 1.6J profile](https://github.com/ocpptools/ocpptools/blob/main/docs/reference/simulator/ocpp-1.6.md)    | Connectors, transactions, charging profiles, configuration, reset                |
| [OCPP 2.0.1 profile](https://github.com/ocpptools/ocpptools/blob/main/docs/reference/simulator/ocpp-2.0.1.md) | EVSEs, device model, monitoring, reservations, displays, certificates            |
| [Security integration](https://github.com/ocpptools/ocpptools/blob/main/docs/reference/simulator/security.md) | Opt-in certificate validation, revocation, CSR, firmware verification, ISO 15118 |
| [Scenarios](https://github.com/ocpptools/ocpptools/blob/main/docs/reference/simulator/scenarios.md)           | Scenario steps, cancellation, results                                            |
| [Persistence](https://github.com/ocpptools/ocpptools/blob/main/docs/reference/simulator/persistence.md)       | Storage, autosave, snapshots, restore                                            |
| [Lab controls](https://github.com/ocpptools/ocpptools/blob/main/docs/reference/simulator/lab-controls.md)     | Fault injection, outbound validation, metrics, inbound response modes            |

## Limits

- The Node adapter uses the portable built-in `WebSocket`. The factory only
  sets the URL and subprotocol, so custom headers and mutual TLS require a
  wrapper or subclass that captures the `ws` options you need and is passed as
  the injected constructor.
- Real cryptography and ISO 15118 ship as opt-in callbacks (ADR 0009, ADR 0011,
  ADR 0012). No X.509, ASN.1, EXI, OCSP or CRL parser is bundled, and there is
  no firmware flashing or log upload.
- The device-model catalog is curated to four variables (ADR 0008), and OCPP
  2.1.0 is deferred (ADR 0010). Protocol actions and reports ignore variables
  outside the catalog.
- No hardware model or physical connector tree.
- The browser and Node adapters use the injected `WebSocket`; they do not retry
  by themselves. Reconnection belongs to the engine; see the
  [reconnection policy](https://github.com/ocpptools/ocpptools/blob/main/docs/SIMULATOR-RECONNECTION.md).
- `storage` is optional and the caller owns persistence policy and secrets such
  as credentials in URLs.
- No feature claims conformance evidence.

## Related packages

- [`@ocpptools/core`](https://github.com/ocpptools/ocpptools/tree/main/packages/core):
  the `Transport`, `Clock`, and `Storage` interfaces the simulator uses.
- [`@ocpptools/testing`](https://github.com/ocpptools/ocpptools/tree/main/packages/testing):
  mock CSMS, in-memory transport, and fake clock for tests.
- [`@ocpptools/validator`](https://github.com/ocpptools/ocpptools/tree/main/packages/validator):
  schema validation for outbound calls.
- [`ocpptools`](https://github.com/ocpptools/ocpptools/tree/main/packages/cli):
  runs simulator scenarios from JSON files.

## License

Apache-2.0. See the repository `LICENSE` and `NOTICE`. The Open Charge
Alliance's JSON Schemas are not part of this package.

OCPP is a specification of the Open Charge Alliance. This project is not
affiliated with, endorsed by, or certified by the Open Charge Alliance.
