# Examples

Each example is a real workspace package. It installs the published package
interfaces from the workspace, runs with Node, and has an executable test.
Build the workspace once before running an example:

```bash
pnpm install
pnpm build
```

| Example                                                      | What it shows                                              | Command                                                        |
| ------------------------------------------------------------ | ---------------------------------------------------------- | -------------------------------------------------------------- |
| [`validate-frame`](../examples/validate-frame)               | Validate an OCPP 2.0.1 frame with the published schemas.   | `pnpm --filter @ocpptools-example/validate-frame start`        |
| [`simulate-charge-point`](../examples/simulate-charge-point) | Run a headless 1.6J charge point against a mock CSMS.      | `pnpm --filter @ocpptools-example/simulate-charge-point start` |
| [`build-payload`](../examples/build-payload)                 | Build a schema-valid CALL frame.                           | `pnpm --filter @ocpptools-example/build-payload start`         |
| [`testing-harness`](../examples/testing-harness)             | Use the mock CSMS, in-memory transport, and frame factory. | `pnpm --filter @ocpptools-example/testing-harness start`       |

Run every example test with:

```bash
pnpm build
pnpm test:examples
```

`pnpm verify` runs `test:examples` after the build, and CI runs `pnpm verify`
on Node 22 and 24. The examples are private workspace packages; they are not
published to npm.
