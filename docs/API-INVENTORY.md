# Public API inventory

- Date: 2026-11-11
- Status: pre-launch inventory. The API is not frozen at 1.0.0.
- Scope: every published package plus the CLI. `@ocpptools/schemas` is included
  because it has public subpaths and a separate license.

## Package matrix

| Package                   | Version | Entrypoints                                    | Runtime dependencies                         | `sideEffects` | Stability |
| ------------------------- | ------- | ---------------------------------------------- | -------------------------------------------- | ------------- | --------- |
| `@ocpptools/core`         | 0.3.1   | `.`                                            | none                                         | `false`       | alpha     |
| `@ocpptools/schema-utils` | 0.3.1   | `.`                                            | none                                         | `false`       | alpha     |
| `@ocpptools/validator`    | 0.3.0*  | `.`                                            | `core`, `schema-utils`, `ajv`, `ajv-formats` | `false`       | alpha     |
| `@ocpptools/simulator`    | 0.4.1   | `.`, `./1.6`, `./2.0.1`, `./browser`, `./node` | `core`                                       | `false`       | alpha     |
| `@ocpptools/builder`      | 0.1.0   | `.`                                            | `core`, `schema-utils`                       | `false`       | alpha     |
| `@ocpptools/testing`      | 0.1.1*  | `.`                                            | `core`                                       | `false`       | alpha     |
| `@ocpptools/schemas`      | 0.1.0   | `./1.6/*`, `./2.0.1/*`, `./manifest.json`      | none                                         | `false`       | alpha     |
| `ocpptools` (CLI)         | 0.1.1   | `.` (library), `bin`                           | `core`, `schemas`, `simulator`, `validator`  | `false`       | alpha     |

All packages are ESM-only, Node >= 22.12, and publish with
`publishConfig.access: public`. Code packages expose `types` and `import`
conditions and include `dist` plus `NOTICE`.

## Exported values

### `@ocpptools/core`

- Frames: `MESSAGE_TYPE`, `isCall`, `isCallError`, `isCallResult`,
  `inspectFrame`, `parseFrame`, `serializeFrame`, `MAX_MESSAGE_ID_LENGTH`.
- Errors: `OCPP_ERROR_CODES`, `isErrorCode`.
- IDs: `createMessageIdGenerator`.
- Versions: `OCPP_VERSIONS`, `OCPP_SUBPROTOCOLS`, `isOcppVersion`.

Types include `OcppFrame`, the three frame types, `MessageType`, `MessageId`,
`OcppErrorCode`, `InspectFrameOptions`, `FrameInspection`, `FrameIssue`,
`ParseFrameError`, `SerializeFrameError`, `Result`, `JsonValue`, `JsonObject`,
`JsonPrimitive`, `Clock`, `TimerHandle`, `Storage`, and the transport types.

### `@ocpptools/schema-utils`

- `detectDraft`, `getFields`, `normalizeSchema`, `applyDefaults`,
  `createEmptyPayload`, `resolveRefs`.

Types include `Field`, `FieldKind`, `NormalizedSchema`, `NormalizeWarning`,
`NormalizeError`, `ResolveError`, `ResolveOptions`, `ApplyDefaultsError`,
`EmptyPayloadOptions`, and the JSON Schema types.

### `@ocpptools/validator`

- `createValidator`, `createSchemaRegistry`, `schemaFileName`,
  `SchemaLoadError`.

Types include `Validator`, `ValidationResult`, `ValidationIssue`,
`ValidationStatus`, `ValidationIssueCode`, `PayloadKind`, `SchemaRegistry`,
`CreateValidatorOptions`, and `ValidateFrameOptions`.

### `@ocpptools/simulator`

- Root: `createSimulator`, `SIMULATOR_NAME`, `runScenario`,
  `scenarioEntityId`, `scenarioIdToken`, `Scheduler`, `EngineBase`, `Metrics`,
  `Connection`, `OfflineQueue`, `EventEmitter`, `History`, `Rpc`,
  `defaultRandom`, `SimulatorError`, `SimulatorCallError`,
  `SimulatorValidationError`, `errorSnapshot`.
- `./1.6`: `Simulator16`, `createSimulator16`, `startChargingSession`,
  `startTransaction`, `sendMeterValues`, `sendStatusNotification`.
- `./2.0.1`: `Simulator201`, `createSimulator201`, and the 2.0.1 helpers.
- `./browser`: `browserClock`, `createWebSocketTransportFactory`,
  `createWebStorage`.
- `./node`: the Node WebSocket transport, clock, and storage adapters.

### `@ocpptools/builder`

- `createBuilder`.

Types include `Builder`, `BuilderOptions`, `BuilderResult`, `BuilderIssue`,
`BuilderIssueCode`, `BuilderWarning`, `BuilderWarningCode`, `BuilderSchemaRegistry`,
`BuilderSource`, `BuildPayloadOptions`, `CallOptions`, `EmptyPayloadOptions`,
`FieldsOptions`, `PayloadKind`, and `JsonLimits`.

### `@ocpptools/testing`

- `createMockCsms`, `createFrameFactory`, `createSyntheticFixtures`,
  `createInMemoryTransportPair`, `createInMemoryTransportHub`,
  `createFakeClock`, `flushMicrotasks`.
- Errors: `FakeClockError`, `FrameFactoryError`, `InMemoryTransportError`,
  `MockCsmsCallError`, `MockCsmsError`.

### `@ocpptools/schemas`

- `./1.6/<Action>.json` and `./1.6/<Action>Response.json`.
- `./2.0.1/<Action>Request.json` and `./2.0.1/<Action>Response.json`.
- `./manifest.json` with the SHA-256 of every file.

### `ocpptools` CLI

- Library: `runCli`, `parseArgs`, `usage`, `UsageError`, `CLI_VERSION`,
  `createCliValidator`, `createCliSchemaRegistry`, `formatValidationResult`,
  `readInput`, `validateFrameFile`, and the simulation helpers.
- Binary: `ocpptools validate`, `ocpptools simulate`, `ocpptools version`.

## Compatibility rules

- 0.x: a minor release may break the API, and every break needs a changeset.
  A patch release must not break documented behavior.
- 1.0 is not frozen. The post-launch 1.0 policy needs real consumer feedback
  and a separate ADR.
- Deprecations are additive: keep accepting the old value, document the
  replacement, and remove it only in a minor release before 1.0 or a major
  release after 1.0.
- `MessageTypeNotSupported` is deprecated for OCPP 2.0.1 but stays accepted.
- Subpaths are explicit. No package uses `export *` at the entrypoint, and no
  package exposes internals through a wildcard.

## Pre-launch checks

`scripts/check-api-inventory.mjs` verifies:

- every published package declares `exports`, `types`, `files`,
  `repository.directory`, `sideEffects: false`, and public access;
- every code entrypoint has `types` and `import` targets that exist after the
  build;
- the `schemas` subpaths point at the schema directories and manifest;
- the package names, directories, and entrypoints match the list used by this
  inventory.

The check runs in `pnpm verify` after the build. It does not freeze the API;
it catches packaging drift.

## Out of scope

- TypeDoc HTML is generated locally and in CI but is not hosted yet.
- OCPP 2.1.0 is not part of the public API.
- `@ocpptools/kit` is not created. See [ROADMAP](../ROADMAP.md).

`*` `@ocpptools/validator@0.3.1` is staged and awaits approval; `@ocpptools/testing@0.1.2` is blocked on the npm trusted publisher. The table shows the live `latest` version.
