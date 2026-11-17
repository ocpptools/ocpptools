# Lab controls

Fault injection, outbound validation, metrics, and inbound response modes.

Back to the [simulator reference](README.md) · [package README](../../../packages/simulator/README.md)

`setFaults()` applies drop, malformation, and latency to every outbound frame:
CALL, CALLRESULT, CALLERROR, raw frames, and queued replays. The order is
drop, then malformation, then latency. Faults emit `fault` events and
`[DROP]`, `[MALFORMED]`, or `[LATENCY]` history entries. A dropped CALL stays
pending until its timeout; a dropped reply is discarded without a retry.

`setValidationMode()` and the `validation.validateOutbound` option run the
callback for every CALL before it becomes pending or enters the offline queue.
`warn` emits `validation`, `notice`, and history and continues; `block` rejects
with `SimulatorValidationError`. Responses are not validated.

`getMetrics()` reports RTT per action, errors in the last minute, and heartbeat
drift. A `metrics` event follows each RTT, error, heartbeat, and reset, and
`resetMetrics()` clears the counters. `setInboundResponseMode('reject')`
returns schema-valid rejections for the status-shaped commands. The package does
not depend on Ajv or the OCA schemas.
