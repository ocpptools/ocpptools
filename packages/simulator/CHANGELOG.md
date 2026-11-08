# @ocpptools/simulator

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
