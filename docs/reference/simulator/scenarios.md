# Scenarios

Scenario steps, cancellation, and results of `runScenario()`.

Back to the [simulator reference](README.md) · [package README](../../../packages/simulator/README.md)

The samples use `simulator` for an instance created as in the
[package README quick start](../../../packages/simulator/README.md#quick-start).

`runScenario()` executes a neutral step list against either protocol version:
`boot`, `heartbeat`, `status`, `authorize`, `start`, `wait`, `meter`, `stop`,
and arbitrary `call` steps. Steps accept `entityId`, the 1.6 `connectorId`
alias, or the 2.0.1 `evseId` alias; token steps accept `idToken` or `idTag`.

```ts
const run = simulator.runScenario([
  { type: 'start', entityId: 1, idToken: 'AABBCCDD' },
  { type: 'wait', ms: 5000 },
  { type: 'meter', entityId: 1 },
  { type: 'stop', entityId: 1 },
]);

const result = await run.done;
if (result.status !== 'completed') {
  console.error(result.error);
}
```

Waits use the injected scheduler and `cancel()` stops the current wait. A
completed transaction is not stopped by default; set `stopOnCancel: true` to
stop transactions the scenario started. The runner emits `scenario` events for
`started`, `step`, `completed`, `failed`, and `cancelled`, and returns a
`ScenarioResult` instead of throwing for expected step failures.
`runChargingScenario()` remains available on both versions as a convenience
wrapper.
