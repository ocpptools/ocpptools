# Testing harness

Shows the mock CSMS, the in-memory transport, and the frame factory without a
socket, a browser, or a real CSMS.

```bash
pnpm build
pnpm --filter @ocpptools-example/testing-harness start
pnpm --filter @ocpptools-example/testing-harness test
```

The mock has no built-in OCPP responses. Every handler is explicit, and the
package contains no OCA schema data.
