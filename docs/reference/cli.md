# CLI reference

Complete reference for the `ocpptools` command-line tool. For installation and a
quick start, see the [CLI README](../../packages/cli/README.md). For a
walkthrough, see
[Run a simulated charge point against your CSMS](../guides/simulate-against-a-csms.md)
and [Validate OCPP frames in CI](../guides/validate-in-ci.md).

## Usage

```text
ocpptools validate <frame.json> --version <1.6|2.0.1> [--action <RequestAction>] [--no-schema] [--json]
ocpptools simulate --config <file> --scenario <file> [--json]
ocpptools scenario run <file> --config <file> [--json]
ocpptools --help
ocpptools --version
```

| Option                | Meaning                                                    |
| --------------------- | ---------------------------------------------------------- |
| `--version <version>` | OCPP version of the frame: `1.6` or `2.0.1`.               |
| `--action <action>`   | Request action of a CALLRESULT, used to check its payload. |
| `--no-schema`         | Skip the OCA payload schemas (ocpptools 0.2.0 and later).  |
| `--config <file>`     | Simulator config JSON file.                                |
| `--scenario <file>`   | Scenario JSON file.                                        |
| `--json`              | Print the machine-readable result as JSON.                 |
| `-h`, `--help`        | Show the help and exit.                                    |
| `-v`, `--version`     | Show the CLI version and exit (without a command).         |

Use `-` as a file name to read standard input. The parser is strict: unknown
options, repeated options, and extra arguments are errors (exit code `2`).

## validate

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

### Frame-only validation

`--no-schema` is available from ocpptools 0.2.0. It validates with a permissive
schema for every action:

- JSON parsing, the frame layout, message IDs, message types, and the
  per-version CALLERROR code set are still checked.
- Payload fields are not checked against the OCA schemas.
- A well-formed frame is `valid` with any payload; a malformed frame is still
  invalid.

It is the fallback if the OCA schema package cannot be used. See
[OCA-CONTINGENCY.md](../OCA-CONTINGENCY.md).

## simulate

`simulate` connects a charge point to the configured CSMS, runs the steps in
order, disconnects, and disposes the simulator. `scenario run` is an alias.

```sh
ocpptools simulate --config charge-point.json --scenario run.json
ocpptools scenario run run.json --config charge-point.json --json
```

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

For OCPP 1.6J, the station shape is:

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

Every config key:

| Key                              | Type and range                                     |
| -------------------------------- | -------------------------------------------------- |
| `station.id`                     | String. Required.                                  |
| `station.vendor` (1.6J)          | String. Required for 1.6J.                         |
| `station.vendorName` (2.0.1)     | String. Required for 2.0.1.                        |
| `station.model`                  | String. Required.                                  |
| `station.firmwareVersion`        | String. Required.                                  |
| `station.connectorCount` (1.6J)  | Integer, at least 1.                               |
| `station.evseCount` (2.0.1)      | Integer, at least 1.                               |
| `station.defaultIdTag` (1.6J)    | String.                                            |
| `station.defaultIdToken` (2.0.1) | String.                                            |
| `station.idTokenType` (2.0.1)    | One of the 2.0.1 idToken types listed above.       |
| `station.defaultChargingPowerKw` | Number, at least 0.                                |
| `boot.auto`                      | Boolean.                                           |
| `boot.required`                  | Boolean.                                           |
| `boot.retryOnPending`            | Boolean.                                           |
| `boot.retryIntervalMs`           | Number, greater than 0.                            |
| `timing.pendingCallTimeoutMs`    | Number, greater than 0.                            |
| `timing.heartbeatIntervalMs`     | Number, greater than 0.                            |
| `timing.meterValueIntervalMs`    | Number, at least 0.                                |
| `reconnect.enabled`              | Boolean.                                           |
| `reconnect.maxAttempts`          | Integer, at least 1.                               |
| `reconnect.baseDelayMs`          | Number, greater than 0.                            |
| `reconnect.maxDelayMs`           | Number, greater than 0 and at least `baseDelayMs`. |
| `reconnect.jitter`               | Boolean.                                           |
| `faults.latencyMs`               | Number, 0 to 60000.                                |
| `faults.dropRate`                | Number, 0 to 1.                                    |
| `faults.malformRate`             | Number, 0 to 1.                                    |
| `validation.mode`                | `off`, `warn`, or `block`.                         |
| `inbound.policy`                 | `auto` or `reject`.                                |
| `history.maxEntries`             | Integer, at least 1.                               |
| `storage.directory`              | String. Without it, state is kept in memory.       |
| `storage.key`                    | String.                                            |
| `storage.autoSave`               | Boolean.                                           |
| `storage.saveDebounceMs`         | Number, at least 0.                                |
| `storage.includeHistory`         | Boolean.                                           |

The CLI waits up to 15 seconds for the connection to open (and, with
`boot.auto`, for the `BootNotification` to be accepted). The timeout is not
configurable from the config file; when it expires, the command exits with
code `3`.

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

`--json` only affects results. Errors that stop the command before a result
exists (an invalid option, an unreadable or invalid file, or a connection
failure) are written to standard error as plain text in both modes, and nothing
is written to standard output. This also applies to `validate`. Validation
warnings and storage errors during a run are also written to standard error.

### Signals

`SIGINT` and `SIGTERM` cancel the current scenario, stop transactions started by
it, and disconnect the simulator. The command exits with `130` for `SIGINT` and
`143` for `SIGTERM`.

### Exit codes

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
