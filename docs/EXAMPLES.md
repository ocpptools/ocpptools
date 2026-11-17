# Examples

Each example is a small program with a test. CI runs every example against the
packages built from this repository, so the code stays correct.

| Example                                                      | What it shows                                              | Packages                                     |
| ------------------------------------------------------------ | ---------------------------------------------------------- | -------------------------------------------- |
| [`validate-frame`](../examples/validate-frame)               | Validate an OCPP 2.0.1 frame with the official schemas.    | `@ocpptools/validator`, `@ocpptools/schemas` |
| [`simulate-charge-point`](../examples/simulate-charge-point) | Run a headless 1.6J charge point against a mock CSMS.      | `@ocpptools/simulator`, `@ocpptools/testing` |
| [`build-payload`](../examples/build-payload)                 | Build a CALL frame from the official schema.               | `@ocpptools/builder`, `@ocpptools/schemas`   |
| [`testing-harness`](../examples/testing-harness)             | Use the mock CSMS, in-memory transport, and frame factory. | `@ocpptools/testing`                         |

## Use an example in your own project

Each example is a single `index.mjs` file. Copy it into a new folder, install
the packages listed in its README from npm, and run it:

```sh
mkdir my-example
cd my-example
npm init -y
npm install @ocpptools/validator @ocpptools/schemas
# copy examples/validate-frame/index.mjs here
node index.mjs
```

## Run the examples in this repository

Build the workspace once, then run an example or all their tests:

```sh
pnpm install
pnpm build
pnpm --filter @ocpptools-example/validate-frame start
pnpm test:examples
```

| Example                 | Command                                                        |
| ----------------------- | -------------------------------------------------------------- |
| `validate-frame`        | `pnpm --filter @ocpptools-example/validate-frame start`        |
| `simulate-charge-point` | `pnpm --filter @ocpptools-example/simulate-charge-point start` |
| `build-payload`         | `pnpm --filter @ocpptools-example/build-payload start`         |
| `testing-harness`       | `pnpm --filter @ocpptools-example/testing-harness start`       |

`pnpm verify` runs `test:examples` after the build, and CI runs the same step
on Node.js 22 and 24. The examples are private workspace packages; they are not
published to npm.

For a guided walkthrough, see [Getting started](getting-started.md).
