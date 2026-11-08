---
'@ocpptools/simulator': minor
---

Apply the lab faults to every outbound frame and make outbound validation and metrics effective.

`setFaults()` now drops, truncates, or delays CALL, CALLRESULT, CALLERROR, raw frames, and queued replays through one pipeline in the documented order. Faults emit `fault` events and `[DROP]`, `[MALFORMED]`, or `[LATENCY]` history entries. Dropped CALLs remain pending until they time out; dropped replies are discarded without a retry. In-flight delayed frames are cancelled on transport close and are never sent on a later connection, and a queued CALL that is cancelled returns to the queue.

`validateOutbound` now runs for every CALL before it becomes pending or enters the queue. `warn` emits `validation`, `notice`, and history; `block` rejects with `SimulatorValidationError`; a throwing callback is reported and respects the same mode. Responses are not validated.

Metrics are recorded from `error` and `pending` events, so RPC, connection, invalid-frame, timeout, and blocked-validation failures share one source. A `metrics` event is emitted after RTT, errors, heartbeat updates, and resets, and heartbeat drift is recorded when the heartbeat completes.

The missed Step A behavior is included: manual OCPP 1.6 meter values no longer advance energy, and `GetBaseReport` uses the same variable-characteristic derivation as `GetReport`.
