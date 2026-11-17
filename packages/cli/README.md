# ocpptools

Command-line validation of OCPP-J frames and headless simulator scenarios for OCPP 1.6J and 2.0.1.

[![npm](https://img.shields.io/npm/v/ocpptools)](https://www.npmjs.com/package/ocpptools)
[![License](https://img.shields.io/npm/l/ocpptools)](https://github.com/ocpptools/ocpptools/blob/main/LICENSE)

> **Status:** alpha. The API can change in any minor release before 1.0.0.

![The ocpptools CLI validates a valid and an invalid OCPP 2.0.1 BootNotification, then runs a five-step simulator scenario against a CSMS.](https://raw.githubusercontent.com/ocpptools/ocpptools/main/docs/assets/cli-demo.gif)

## When to use it

- You want to check OCPP frames against the official OCPP JSON Schemas from the
  terminal or in CI, without writing code.
- You want to run a scripted charging station session against your CSMS from a
  JSON file.
- To validate or simulate from your own code, use
  [`@ocpptools/validator`](https://github.com/ocpptools/ocpptools/tree/main/packages/validator)
  or
  [`@ocpptools/simulator`](https://github.com/ocpptools/ocpptools/tree/main/packages/simulator)
  directly.

## Install

Run it without installing:

```sh
npx ocpptools --help
```

Or install it globally:

```sh
npm install --global ocpptools
```

Requires Node.js 22.12 or newer. The package is ESM-only and uses the built-in
Node `WebSocket`; it has no `ws` runtime dependency. The first `npx` run
downloads the OCPP JSON Schemas with the CLI, which can take a moment.

## Quick start

Validate a frame:

```sh
ocpptools validate frame.json --version 2.0.1
```

```text
Invalid: frame.json (invalid-payload)
  /3/chargingStation/vendorName [schema-violation] The property "vendorName" is required
```

Run a scenario against a CSMS:

```sh
ocpptools simulate --config charge-point.json --scenario run.json
```

The sections below show the file formats.

## Validate a frame

```sh
ocpptools validate frame.json --version 2.0.1
ocpptools validate frame.json --version 1.6 --json
ocpptools validate - --version 1.6 < frame.json
```

`validate` reads one JSON file, or standard input with `-`. It checks the frame
structure and the payload against the official schema of the action, and prints
one line per issue with its JSON Pointer, code, and message. `--json` prints
the `ValidationResult` of `@ocpptools/validator`.

A CALLRESULT does not name its action. Pass the request action so its payload is
checked instead of only warned about:

```sh
ocpptools validate heartbeat-response.json --version 1.6 --action Heartbeat
```

From ocpptools 0.2.0, `--no-schema` skips the payload schemas but still checks
the JSON, the frame layout, and the CALLERROR code set of the version.

| Exit code | Meaning                                                                        |
| --------- | ------------------------------------------------------------------------------ |
| `0`       | The frame is valid, possibly with warnings.                                    |
| `1`       | The frame is invalid.                                                          |
| `2`       | The file is missing or unreadable, the JSON is invalid, or an option is wrong. |
| `3`       | An unexpected internal failure occurred.                                       |

`--version` accepts `1.6` and `2.0.1`. OCPP 2.1.0 is deferred and exits with
code `2`.

## Run a scenario against a CSMS

Describe the station in `charge-point.json`:

```json
{
  "version": "2.0.1",
  "url": "ws://127.0.0.1:9000/CP001",
  "station": {
    "id": "CP001",
    "vendorName": "Acme",
    "model": "AC-22",
    "firmwareVersion": "2.0.0",
    "evseCount": 1,
    "defaultIdToken": "AABBCCDD"
  }
}
```

List the steps in `run.json`:

```json
[
  { "type": "boot" },
  { "type": "authorize", "idToken": "AABBCCDD" },
  { "type": "start", "idToken": "AABBCCDD" },
  { "type": "meter" },
  { "type": "stop", "reason": "Local" }
]
```

Run it:

```sh
ocpptools simulate --config charge-point.json --scenario run.json
ocpptools scenario run run.json --config charge-point.json --json
```

`simulate` connects to the CSMS, runs the steps in order, disconnects, and
prints every step with its status. `scenario run` is an alias. `SIGINT` and
`SIGTERM` cancel the scenario and stop the transactions it started.

| Exit code | Meaning                                                                       |
| --------- | ----------------------------------------------------------------------------- |
| `0`       | The scenario completed.                                                       |
| `2`       | A config or scenario file is missing, invalid JSON, or has an invalid shape.  |
| `3`       | Connection failure, or the scenario failed or was cancelled without a signal. |
| `130`     | Cancelled by `SIGINT`.                                                        |
| `143`     | Cancelled by `SIGTERM`.                                                       |

The config also controls boot, timing, reconnection, fault injection, outbound
validation, inbound responses, history, and persistence. The
[CLI reference](https://github.com/ocpptools/ocpptools/blob/main/docs/reference/cli.md)
lists every config key, the OCPP 1.6J station shape, and every step type.

## Guides

- [Validate OCPP frames in CI](https://github.com/ocpptools/ocpptools/blob/main/docs/guides/validate-in-ci.md)
- [Run a simulated charge point against your CSMS](https://github.com/ocpptools/ocpptools/blob/main/docs/guides/simulate-against-a-csms.md)

## API

The package also exports its building blocks (`runCli`, `parseArgs`,
`validateFrameFile`, `runSimulation`, and others) for tests and tools. See the
[CLI reference](https://github.com/ocpptools/ocpptools/blob/main/docs/reference/cli.md#library-api).

## Limits

- `validate` checks one frame per run. To check a folder, loop over the files;
  see [Validate OCPP frames in CI](https://github.com/ocpptools/ocpptools/blob/main/docs/guides/validate-in-ci.md).
- OCPP 2.1.0 is not supported and exits with code `2`.
- `simulate` waits up to 15 seconds for the CSMS connection and then exits with
  code `3`.
- `--json` only formats results. Option, file, and connection errors are
  written to standard error as plain text.

## Related packages

The CLI loads schemas from
[`@ocpptools/schemas`](https://github.com/ocpptools/ocpptools/tree/main/packages/schemas),
validates with
[`@ocpptools/validator`](https://github.com/ocpptools/ocpptools/tree/main/packages/validator),
and runs the engine of
[`@ocpptools/simulator`](https://github.com/ocpptools/ocpptools/tree/main/packages/simulator).
It duplicates neither protocol logic nor schema data.

## License

Apache-2.0. See the repository `LICENSE` and `NOTICE`. The Open Charge
Alliance's JSON Schemas are loaded from `@ocpptools/schemas`; they are not part
of this package.

OCPP is a specification of the Open Charge Alliance. This project is not
affiliated with, endorsed by, or certified by the Open Charge Alliance.
