# Simulate a charge point

Runs a headless OCPP 1.6J charge point against an in-memory mock CSMS. It boots,
authorizes, starts and meters a transaction, and stops it.

```bash
pnpm build
pnpm --filter @ocpptools-example/simulate-charge-point start
pnpm --filter @ocpptools-example/simulate-charge-point test
```

No socket is opened. Replace `createInMemoryTransportPair` with
`createNodeWebSocketTransportFactory` from `@ocpptools/simulator/node` to connect
to a real CSMS.
