---
'@ocpptools/simulator': minor
---

Add snapshot persistence.

The simulator accepts a `persistence` option with a `Storage`, key, autosave and history flags. `load()`, `save()`, `exportSnapshot()`, and `restoreSnapshot()` round-trip profile state, the offline queue, and optional history without throwing for expected failures. Snapshots carry the protocol version, persisted fault/validation/inbound configuration, heartbeat and meter intervals, and a versioned envelope.

Restore validates the envelope and the version-specific state before mutating the engine, never restores connection, boot, pending calls, metrics, clock offset, or in-flight scenarios, and does not connect automatically. Autosave is debounced with the injected scheduler and cancelled on dispose. Profiles validate and rebuild their own state; active transactions restart meter loops on the next ready transition and 2.0.1 reservations are rearmed.
