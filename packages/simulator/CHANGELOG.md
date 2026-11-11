# @ocpptools/simulator

## 0.4.1

### Patch Changes

- a9b83f6: Ignore an unknown OCPP message type instead of replying with `CALLERROR MessageTypeNotSupported`, following OCPP 2.0.1 Errata 2026-09. The error code stays accepted in `@ocpptools/core` so frames from older peers remain valid, but it is deprecated and new code should not send it.
- @ocpptools/core@0.3.1

## 0.4.0

### Minor Changes

- 84e0b7a: Extend the opt-in 2.0.1 security integration with a CSR provider and
  revocation checks. `certificates.signWithProvider` generates a CSR without
  leaking private keys, `revocation` validates a real `CertificateSigned` chain
  with an explicit unknown-result policy, and `callbackTimeoutMs` bounds every
  injected security callback. Raw certificate requests now reject private-key
  material and malformed CSRs before sending. A signed chain without
  `certificateType` is stored for both uses, and a rejected real chain emits
  `InvalidChargingStationCertificate`.
- c1c60c2: Add an opt-in ISO 15118/EXI codec to the 2.0.1 security integration.
  `certificates.get15118Message` encodes the request, requires an accepted
  `Get15118EVCertificate` response, validates the EXI length, decodes it, and
  optionally runs the codec's response validator. No EXI implementation is
  bundled, and the engine still makes no network requests. The exported
  `Iso15118Codec201` now uses input objects (`{ schemaVersion, action, payload }`,
  `{ schemaVersion, action, exiResponse }`, and `{ schemaVersion, action, response }`)
  instead of positional arguments. Raw 15118 requests are length-checked and
  reject private-key material.
- 3f8e2b1: Add opt-in firmware verification to the 2.0.1 security integration. With a
  `firmwareVerifier`, `UpdateFirmware` validates the request metadata, checks the
  signing certificate when a validator is configured, optionally revocation-checks
  it, and verifies the simulated download afterwards (`SignatureVerified`,
  `InvalidSignature` or `InstallVerificationFailed`). Invalid signing certificates
  return `InvalidCertificate` or `RevokedCertificate`. The verifier owns any image
  download, and the engine still never flashes hardware. Snapshot restore rejects
  invalid firmware signature metadata.
- f50c767: Add `SecurityOptions201` to the 2.0.1 simulator. Consumers can opt into real
  certificate validation by injecting `validateCertificateChain`, or keep the
  default simulated behavior. The engine stays free of crypto dependencies; its
  security state never stores private keys. Snapshots with `includeHistory` can
  retain raw inbound frames in diagnostic history, so callers must redact history
  before saving or exporting sensitive material.

### Patch Changes

- 3ac442a: Make the curated 2.0.1 device-model catalog explicit and enforceable. The four
  hand-written variables are frozen in code, and `GetVariables`, `SetVariables`,
  monitoring, reports, and `deviceModel.variables()` ignore variables added
  outside it. A test fails if the simulator source statically imports OCA schemas,
  ships a JSON catalog, or the catalog changes without an explicit update.
- 055a0ab: Reject unsupported OCPP versions explicitly. Core adds `isOcppVersion` and an
  `unsupported-version` inspection issue; the validator refuses OCPP 2.1.0 before
  loading schemas; the simulator rejects a 2.1.0 snapshot protocol with a clear
  error. OCPP 2.1.0 remains unimplemented.
- Updated dependencies [055a0ab]
  - @ocpptools/core@0.3.0

## 0.3.0

### Minor Changes

- 13850e2: Add the Node adapter in `@ocpptools/simulator/node`: a WebSocket transport
  backed by the Node 22 built-in implementation, `nodeClock`, an in-memory
  `Storage`, and an atomic file-backed `Storage` that hashes keys and retries
  transient rename errors. The package still depends only on `@ocpptools/core` at
  runtime.

## 0.2.0

### Minor Changes

- 1701b7e: Complete the OCPP 1.6J semantics.

  `SetChargingProfile` now validates and stores the profile id, connector, stack, purpose, kind, validity window, transaction binding, and schedule periods, with replacement by id or by purpose and stack. `ClearChargingProfile` applies id, connector, purpose, and stack filters and reports `Unknown` when nothing matches. `GetCompositeSchedule` merges the station maximum with the active transaction or default profile, honors validity and schedule duration, preserves single-phase metadata, and emits one-decimal ampere limits.

  `Reset` implements `Hard` and `Soft` with the correct stop reasons and restarts after the transactions end. `TriggerMessage` validates and handles all six 1.6 messages. `GetConfiguration` returns the modeled catalog and `ChangeConfiguration` applies mutable keys, validates values, restarts heartbeat and meter loops, and rejects readonly or unknown keys.

  `GetDiagnostics` and `UpdateFirmware` emit timed status sequences that cancel on reconnect. Reservations validate their fields, expire with the OCPP clock, and cancel on consume or removal. `ChangeAvailability` applies idle connectors immediately and defers active ones, and `UnlockConnector` clears reservations and stops transactions. The new state fields round-trip through snapshots.

- 35ab168: Harden the OCPP 2.0.1 features.

  Periodic and clock-aligned variable monitors now run on injected timers, honor severity/level and transaction gating, emit `NotifyEvent` records, cancel on clear/base changes or transport close, and rearm on ready or restore. Display messages with `startDateTime`/`endDateTime` are filtered by their active window. `Reset` now stops transactions with the reset reason, reboots the transport for station-level resets with the correct boot reason, handles EVSE-scoped resets without dropping the shared transport, and executes deferred station or EVSE resets once they are idle. `TriggerMessage` additionally handles meter values, firmware, log, and publish-firmware status notifications.

- 9490902: Add the public factory functions (`createSimulator`, `createSimulator16`, `createSimulator201`), the grouped sub-APIs, the `NotifyReport` and `NotifyMonitoringReport` helpers, the engine cleanup and reconnect aliases, a typed `SimulatorConfig`, and the missing OCPP 1.6 start/meter methods. The changes are additive for the 0.1.0 API.

  The 1.6 start paths now respect the station default idTag, restore a reservation when a start fails, validate `meterStart`, include `reservationId` when a reservation is consumed, and leave manual meter values out of the energy counter. Reconnect option updates cancel stale backoff timers, honor a lowered attempt limit, and can disable reconnection from a connection listener. Manual 2.0.1 meter values no longer advance the simulated energy register.

- ecf7da7: Apply the lab faults to every outbound frame and make outbound validation and metrics effective.

  `setFaults()` now drops, truncates, or delays CALL, CALLRESULT, CALLERROR, raw frames, and queued replays through one pipeline in the documented order. Faults emit `fault` events and `[DROP]`, `[MALFORMED]`, or `[LATENCY]` history entries. Dropped CALLs remain pending until they time out; dropped replies are discarded without a retry. In-flight delayed frames are cancelled on transport close and are never sent on a later connection, and a queued CALL that is cancelled returns to the queue.

  `validateOutbound` now runs for every CALL before it becomes pending or enters the queue. `warn` emits `validation`, `notice`, and history; `block` rejects with `SimulatorValidationError`; a throwing callback is reported and respects the same mode. Responses are not validated.

  Metrics are recorded from `error` and `pending` events, so RPC, connection, invalid-frame, timeout, and blocked-validation failures share one source. A `metrics` event is emitted after RTT, errors, heartbeat updates, and resets, and heartbeat drift is recorded when the heartbeat completes.

  The missed Step A behavior is included: manual OCPP 1.6 meter values no longer advance energy, and `GetBaseReport` uses the same variable-characteristic derivation as `GetReport`.

- a1e7444: Add snapshot persistence.

  The simulator accepts a `persistence` option with a `Storage`, key, autosave and history flags. `load()`, `save()`, `exportSnapshot()`, and `restoreSnapshot()` round-trip profile state, the offline queue, and optional history without throwing for expected failures. Snapshots carry the protocol version, persisted fault/validation/inbound configuration, heartbeat and meter intervals, and a versioned envelope.

  Restore validates the envelope and the version-specific state before mutating the engine, never restores connection, boot, pending calls, metrics, clock offset, or in-flight scenarios, and does not connect automatically. Autosave is debounced with the injected scheduler and cancelled on dispose. Profiles validate and rebuild their own state; active transactions restart meter loops on the next ready transition and 2.0.1 reservations are rearmed.

- ca02313: Add the generic scenario runner.

  `runScenario(steps, options)` executes boot, heartbeat, status, authorize, start, wait, meter, stop, and arbitrary CALL steps sequentially for both protocol versions. Waits use the injected scheduler, cancel stops the current wait, and `stopOnCancel` stops transactions the scenario started. The runner emits `scenario` events for started, step, completed, failed, and cancelled, returns a `ScenarioResult`, and never throws for expected step failures.

  `runChargingScenario` is now built on the runner for OCPP 1.6 and is also available for OCPP 2.0.1, keeping the 1.6 helper signature compatible.

## 0.1.0

### Minor Changes

- a8c242d: Add the first public simulator release. It covers all 28 OCPP 1.6J actions and all 64 OCPP 2.0.1 actions, with a headless engine, browser adapter, injectable transport/clock, deterministic tests, and simulated advanced 2.0.1 state.
