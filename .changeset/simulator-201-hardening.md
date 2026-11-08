---
'@ocpptools/simulator': minor
---

Harden the OCPP 2.0.1 features.

Periodic and clock-aligned variable monitors now run on injected timers, honor severity/level and transaction gating, emit `NotifyEvent` records, cancel on clear/base changes or transport close, and rearm on ready or restore. Display messages with `startDateTime`/`endDateTime` are filtered by their active window. `Reset` now stops transactions with the reset reason, reboots the transport for station-level resets with the correct boot reason, handles EVSE-scoped resets without dropping the shared transport, and executes deferred station or EVSE resets once they are idle. `TriggerMessage` additionally handles meter values, firmware, log, and publish-firmware status notifications.
