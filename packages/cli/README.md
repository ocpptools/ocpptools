# ocpptools

Command-line tools for OCPP 1.6J and 2.0.1: validate OCPP-J frames against the
Open Charge Alliance JSON Schemas and run headless charging-station scenarios
against a CSMS.

> **Status:** alpha. APIs are unstable until 1.0.0.

OCPP is a specification of the Open Charge Alliance. This project is not
affiliated with, endorsed by, or certified by the Open Charge Alliance.

## Requirements

- Node.js 22.12 or newer.
- A WebSocket URL that speaks OCPP 1.6J or 2.0.1, for `simulate`.

The package is ESM-only. It uses the built-in Node `WebSocket`; it has no `ws`
runtime dependency.

## Install

```sh
npm install --global ocpptools
```

Or run it from a project:

```sh
npx ocpptools --help
```

## Validate a frame

```sh
ocpptools validate frame.json --version 2.0.1
ocpptools validate frame.json --version 1.6 --json
ocpptools validate - --version 1.6 < frame.json
```

`validate` reads one JSON file, or standard input with `-`. It validates the
frame structure and the payload against the official schema of the action.
`--version` accepts `1.6` and `2.0.1`; OCPP 2.1.0 is deferred and exits with
code `2` instead of loading a schema.

A CALLRESULT does not name its action. Pass the request action so its payload is
checked instead of only warned about:

```sh
ocpptools validate heartbeat-response.json --version 1.6 --action Heartbeat
```

The human output shows `Valid` or `Invalid` and one line per issue with its JSON
Pointer, code, and message. `--json` prints the `ValidationResult` of
`@ocpptools/validator`.

Exit codes:

| Code | Meaning                                                                        |
| ---- | ------------------------------------------------------------------------------ |
| `0`  | The frame is valid, possibly with warnings.                                    |
| `1`  | The frame is invalid.                                                          |
| `2`  | The file is missing or unreadable, the JSON is invalid, or an option is wrong. |
| `3`  | An unexpected internal failure occurred.                                       |

## Run a scenario

```sh
ocpptools simulate --config charge-point.json --scenario run.json
ocpptools scenario run run.json --config charge-point.json --json
```

`simulate` connects a charge point to the configured CSMS, runs the steps in
order, disconnects, and disposes the simulator. `scenario run` is an alias.

### Simulator config

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
  },
  "boot": {
    "auto": false,
    "required": true,
    "retryOnPending": false
  },
  "timing": {
    "pendingCallTimeoutMs": 15000,
    "heartbeatIntervalMs": 60000,
    "meterValueIntervalMs": 30000
  },
  "reconnect": {
    "enabled": false
  },
  "faults": {
    "latencyMs": 0,
    "dropRate": 0,
    "malformRate": 0
  },
  "validation": {
    "mode": "warn"
  },
  "inbound": {
    "policy": "auto"
  },
  "history": {
    "maxEntries": 500
  },
  "storage": {
    "directory": ".cache/ocpptools-state",
    "key": "CP001",
    "autoSave": true
  }
}
```

For OCPP 1.6, the station shape is:

```json
{
  "version": "1.6",
  "url": "ws://127.0.0.1:9000/CP001",
  "station": {
    "id": "CP001",
    "vendor": "Acme",
    "model": "AC-7",
    "firmwareVersion": "1.0.0",
    "connectorCount": 1,
    "defaultIdTag": "AABBCCDD"
  }
}
```

`station.id`, `url`, and `version` are required. The station fields required by
the chosen version must be present. All other sections are optional. The config
`version` accepts `1.6` and `2.0.1`; OCPP 2.1.0 exits with code `2`.

- `boot` defaults to `{ "auto": false, "required": true, "retryOnPending": false }`.
  The CLI sends `BootNotification` only when a scenario has a `boot` step unless
  `auto` is enabled.
- `reconnect` uses the simulator defaults when omitted. The CLI waits through
  reconnect attempts until the connection opens or the connection timeout
  expires.
- `storage` keeps state in memory when it has no `directory`; with a directory,
  it uses `createFileStorage` from `@ocpptools/simulator/node`. State is loaded
  before the run and saved after it. Omit `storage` to disable persistence.
- `validation.mode` is `off` (default), `warn`, or `block`. The CLI always
  supplies the outbound validator from `@ocpptools/validator`; JSON only selects
  the mode.
- `inbound.policy` is `auto` or `reject`.
- For 2.0.1, `station.idTokenType` must be one of `Central`, `eMAID`,
  `ISO14443`, `ISO15693`, `KeyCode`, `Local`, `MacAddress`, or `NoAuthorization`.
- `url` must use `ws://` or `wss://`.
- Unknown fields are ignored. Invalid types, unknown values, and missing
  required fields are config errors.

### Scenario

```json
[
  { "type": "boot" },
  { "type": "authorize", "idToken": "AABBCCDD" },
  { "type": "start", "idToken": "AABBCCDD" },
  { "type": "meter" },
  { "type": "stop", "reason": "Local" }
]
```

The steps are the `ScenarioStep` list of `@ocpptools/simulator`:

| Step        | Fields                                                 |
| ----------- | ------------------------------------------------------ |
| `boot`      | None.                                                  |
| `heartbeat` | None.                                                  |
| `status`    | `status`, and `entityId`, `connectorId`, or `evseId`.  |
| `authorize` | `idToken` (or the 1.6 alias `idTag`) and an entity ID. |
| `start`     | `idToken` (or `idTag`) and an entity ID.               |
| `wait`      | `ms`.                                                  |
| `meter`     | `entityId`, `connectorId`, or `evseId`.                |
| `stop`      | `reason` and an entity ID.                             |
| `call`      | `action` and `payload`, sent as an arbitrary CALL.     |

Steps run sequentially with `stopOnCancel: true`. A failed step ends the
scenario and is reported with its error code. The human output lists every
step with its status; `--json` prints the `ScenarioResult`.

### Signals

`SIGINT` and `SIGTERM` cancel the current scenario, stop transactions started by
it, and disconnect the simulator. The command exits with `130` for `SIGINT` and
`143` for `SIGTERM`.

Exit codes:

| Code  | Meaning                                                                       |
| ----- | ----------------------------------------------------------------------------- |
| `0`   | The scenario completed.                                                       |
| `2`   | A config or scenario file is missing, invalid JSON, or has an invalid shape.  |
| `3`   | Connection failure, or the scenario failed or was cancelled without a signal. |
| `130` | Cancelled by `SIGINT`.                                                        |
| `143` | Cancelled by `SIGTERM`.                                                       |

## Library API

The package also exports its building blocks for tests and tools:

- `runCli(argv, io?)`
- `parseArgs`, `usage`, `UsageError`
- `validateFrameFile`, `formatValidationResult`, `createCliValidator`
- `loadSimulatorConfig`, `loadScenarioFile`, `parseSimulatorConfig`, `parseScenario`
- `applySimulatorConfig`, `createConfiguredSimulator`, `runSimulation`,
  `formatSimulationResult`
- `CLI_VERSION`

The CLI loads schemas from `@ocpptools/schemas`, validates with
`@ocpptools/validator`, and runs the engine of `@ocpptools/simulator`. It
duplicates neither protocol logic nor schema data.

## License

Apache-2.0. See the repository `LICENSE` and `NOTICE`. The OCA JSON Schemas are
loaded from `@ocpptools/schemas`; they are not part of this package. The project
is independent from the Open Charge Alliance.
