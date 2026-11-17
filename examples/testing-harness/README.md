# Testing harness

Shows the mock CSMS, the in-memory transport, and the frame factory of
`@ocpptools/testing` without a socket, a browser, or a real CSMS. A client sends
a `Heartbeat` CALL and the mock CSMS answers it.

The mock has no built-in OCPP responses. Every handler is explicit, and the
package contains no OCA schema data.

## Use it in your own project

```sh
npm install @ocpptools/testing
```

Copy [`index.mjs`](index.mjs) into your project and run `node index.mjs`.

## Run it in this repository

```sh
pnpm build
pnpm --filter @ocpptools-example/testing-harness start
pnpm --filter @ocpptools-example/testing-harness test
```

See also the [testing README](../../packages/testing/README.md) and
[Unit-test OCPP code without a network](../../docs/guides/test-without-a-network.md).
