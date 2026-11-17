# Simulate a charge point

Runs a headless OCPP 1.6J charge point against an in-memory mock CSMS. It boots,
authorizes, starts and meters a transaction, and stops it. No socket is opened,
and a fake clock keeps the run deterministic.

## Use it in your own project

```sh
npm install @ocpptools/simulator @ocpptools/testing
```

Copy [`index.mjs`](index.mjs) into your project and run `node index.mjs`.

To connect to a real CSMS, replace `createInMemoryTransportPair` with
`createNodeWebSocketTransportFactory` and the fake clock with `nodeClock`, both
from `@ocpptools/simulator/node`. See
[Run a simulated charge point against your CSMS](../../docs/guides/simulate-against-a-csms.md).

## Run it in this repository

```sh
pnpm build
pnpm --filter @ocpptools-example/simulate-charge-point start
pnpm --filter @ocpptools-example/simulate-charge-point test
```

See also the [simulator README](../../packages/simulator/README.md).
