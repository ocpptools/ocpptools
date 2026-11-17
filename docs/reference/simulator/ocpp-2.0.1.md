# OCPP 2.0.1 profile

EVSEs, the device model, monitoring, reservations, charging profiles, displays,
and certificates of `Simulator201`.

Back to the [simulator reference](README.md) · [package README](../../../packages/simulator/README.md)

The samples use `simulator` for the `Simulator201` instance created in the
[package README quick start](../../../packages/simulator/README.md#quick-start).

`Simulator201` models EVSE state, device variables, monitoring, local
authorization, reservations, charging profiles, displays, customer and cost
information, firmware, logs, certificates, and security events. All 64 actions
are handled:

- 25 charge-point-to-CSMS actions, including `TransactionEvent`, meter values,
  reports, reservations, charging limits, firmware and log status, certificates,
  and security events.
- 39 CSMS-to-charge-point actions, plus the bidirectional `DataTransfer`
  handler.

The advanced features use simulated state by default. Certificates are in-memory
records without ASN.1 parsing or WebCrypto. Real certificate validation,
revocation, CSR generation, firmware verification, and ISO 15118/EXI are
opt-in callbacks under ADR 0009, ADR 0011, and ADR 0012; no crypto or EXI
implementation is bundled. Firmware and logs are state machines, not real
flashing or uploads. Monitoring thresholds and composite schedules are calculated
from stored state. Periodic and clock-aligned monitors run on the injected
scheduler and emit `NotifyEvent` records. Display messages honor their start and
end dates. Station-level `Reset` stops transactions and reboots the transport;
EVSE-scoped resets stop only that EVSE. `UnlockConnector` follows the
specification and returns `OngoingAuthorizedTransaction` while a transaction is
active instead of stopping it. The device-model catalog is curated, not the
complete standard catalog (ADR 0008). It contains
`OCPPCommCtrlr/HeartbeatInterval`, `AlignedDataCtrlr/Enabled`,
`SampledDataCtrlr/TxUpdatedInterval`, and `DeviceDataCtrlr/Enabled`;
`GetVariables`, `SetVariables`, monitoring, and reports ignore variables added
outside it. OCPP 2.1.0 is deferred (ADR 0010). No feature claims conformance
evidence.

Opt-in real cryptography and ISO 15118 are described in [Security integration](security.md).

## Transactions

```ts
const started = await simulator.startChargingSession(1, 'AABBCCDD');
await simulator.stopTransaction(1, 'Local');

simulator.rpc.handleText(
  JSON.stringify([
    2,
    'in-1',
    'RequestStartTransaction',
    {
      remoteStartId: 1,
      idToken: { idToken: 'AABBCCDD', type: 'ISO14443' },
    },
  ]),
);
```

`TransactionEvent` carries `seqNo`, `transactionInfo`, EVSE, idToken, optional
meter values, and `reservationId` only on the first `Started` event. Sequence
numbers advance only after a send or queue succeeds.

## Device model and monitoring

`SetVariables`, `GetVariables`, `GetBaseReport`, `GetReport`, `SetVariableMonitoring`,
`ClearVariableMonitoring`, `SetMonitoringBase`, and `SetMonitoringLevel` use
serializable device state. Reports are queued before boot and return
`EmptyResultSet` instead of an empty required array.

## Local authorization and reservations

`SendLocalList` supports Full and Differential updates. Local accepted entries
authorize without a CSMS call; blocked or expired entries fall back to
`Authorize` when online. Reservations enforce the token or group, are consumed
by starts, expire with the injected clock, and are cancelled when an EVSE
becomes unavailable or faulted.

## Charging profiles

`SetChargingProfile`, `ClearChargingProfile`, `GetChargingProfiles`, and
`GetCompositeSchedule` store profiles by EVSE and support the station-wide slot 0. Composite schedules honor validity, schedule duration, start times, stack
level per purpose, `TxProfile` precedence, and W/A conversion. `TxProfile`
requires an active matching transaction and is removed when it ends.

## Displays, customer, firmware, and logs

Display messages support priorities, states, and transaction-scoped cleanup.
Customer information accepts token, identifier, or certificate selectors.
Firmware update honors retrieve and install times and emits status
notifications. Log upload emits `LogStatusNotification`.

## Certificates and security

`InstallCertificate`, `DeleteCertificate`, `GetInstalledCertificateIds`, and
`CertificateSigned` store simulated certificate records. `SignCertificate`,
`Get15118EVCertificate`, `GetCertificateStatus`, and `SecurityEventNotification`
are available on the public API.
