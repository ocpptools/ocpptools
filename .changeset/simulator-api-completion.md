---
'@ocpptools/simulator': minor
---

Add the public factory functions (`createSimulator`, `createSimulator16`, `createSimulator201`), the grouped sub-APIs, the `NotifyReport` and `NotifyMonitoringReport` helpers, the engine cleanup and reconnect aliases, a typed `SimulatorConfig`, and the missing OCPP 1.6 start/meter methods. The changes are additive for the 0.1.0 API.

The 1.6 start paths now respect the station default idTag, restore a reservation when a start fails, validate `meterStart`, include `reservationId` when a reservation is consumed, and leave manual meter values out of the energy counter. Reconnect option updates cancel stale backoff timers, honor a lowered attempt limit, and can disable reconnection from a connection listener. Manual 2.0.1 meter values no longer advance the simulated energy register.
