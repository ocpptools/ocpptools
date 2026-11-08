---
'@ocpptools/simulator': minor
---

Add the generic scenario runner.

`runScenario(steps, options)` executes boot, heartbeat, status, authorize, start, wait, meter, stop, and arbitrary CALL steps sequentially for both protocol versions. Waits use the injected scheduler, cancel stops the current wait, and `stopOnCancel` stops transactions the scenario started. The runner emits `scenario` events for started, step, completed, failed, and cancelled, returns a `ScenarioResult`, and never throws for expected step failures.

`runChargingScenario` is now built on the runner for OCPP 1.6 and is also available for OCPP 2.0.1, keeping the 1.6 helper signature compatible.
