# OCPP 1.6J profile

Connectors, transactions, charging profiles, configuration, reset, and the CSMS
commands of `Simulator16`.

Back to the [simulator reference](README.md) · [package README](../../../packages/simulator/README.md)

The samples use `simulator16` for a `Simulator16` instance from
`@ocpptools/simulator/1.6`, created like the 2.0.1 instance in the
[package README quick start](../../../packages/simulator/README.md#quick-start)
with the 1.6J station shape.

`Simulator16` models connectors, status notifications, authorization,
transactions, meter values, reservations, local authorization, diagnostics,
firmware status, data transfer, and the 19 CSMS commands. Connector state is
serializable and survives reconnects.

```ts
const started = await simulator16.startChargingSession(1, 'AABBCCDD');
await simulator16.stopTransaction(1, 'Local');
```

The profile keeps the full 1.6 action surface: 9 charge-point actions and 19
CSMS commands. Charging profiles support replacement by id or by purpose and
stack, filtered clearing, and composite schedules that merge the station
maximum with the active transaction or default profile. `Hard` and `Soft`
reset follow the 1.6 behavior, `TriggerMessage` handles every 1.6 message, and
`GetConfiguration`/`ChangeConfiguration` model the writable catalog. Diagnostics
and firmware emit timed status sequences, reservations expire with the OCPP
clock, and availability changes apply immediately to idle connectors and after
the active transaction to the rest.
