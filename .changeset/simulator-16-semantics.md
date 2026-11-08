---
'@ocpptools/simulator': minor
---

Complete the OCPP 1.6J semantics.

`SetChargingProfile` now validates and stores the profile id, connector, stack, purpose, kind, validity window, transaction binding, and schedule periods, with replacement by id or by purpose and stack. `ClearChargingProfile` applies id, connector, purpose, and stack filters and reports `Unknown` when nothing matches. `GetCompositeSchedule` merges the station maximum with the active transaction or default profile, honors validity and schedule duration, preserves single-phase metadata, and emits one-decimal ampere limits.

`Reset` implements `Hard` and `Soft` with the correct stop reasons and restarts after the transactions end. `TriggerMessage` validates and handles all six 1.6 messages. `GetConfiguration` returns the modeled catalog and `ChangeConfiguration` applies mutable keys, validates values, restarts heartbeat and meter loops, and rejects readonly or unknown keys.

`GetDiagnostics` and `UpdateFirmware` emit timed status sequences that cancel on reconnect. Reservations validate their fields, expire with the OCPP clock, and cancel on consume or removal. `ChangeAvailability` applies idle connectors immediately and defers active ones, and `UnlockConnector` clears reservations and stops transactions. The new state fields round-trip through snapshots.
