# Simulator reference

Reference pages for `@ocpptools/simulator`. Start with the
[package README](../../../packages/simulator/README.md) for installation and a
quick start.

| Page                                | Covers                                                                                |
| ----------------------------------- | ------------------------------------------------------------------------------------- |
| [Engine](engine.md)                 | Factories, injected transport and clock, lifecycle, state, events, errors             |
| [OCPP 1.6J profile](ocpp-1.6.md)    | `Simulator16`: connectors, transactions, charging profiles, configuration, reset      |
| [OCPP 2.0.1 profile](ocpp-2.0.1.md) | `Simulator201`: EVSEs, device model, monitoring, reservations, displays, certificates |
| [Security integration](security.md) | Opt-in certificate validation, revocation, CSR, firmware verification, ISO 15118      |
| [Scenarios](scenarios.md)           | `runScenario()` steps, cancellation, results                                          |
| [Persistence](persistence.md)       | Storage, autosave, snapshots, restore                                                 |
| [Lab controls](lab-controls.md)     | Fault injection, outbound validation, metrics, inbound response modes                 |

Related explanations:

- [Reconnection policy](../../SIMULATOR-RECONNECTION.md)
- [Timers](../../SIMULATOR-TIMERS.md)
- [Cryptography and ISO 15118 threat model](../../security/crypto-15118.md)
- ADRs [0006](../../ADR/0006-simulator-conventions.md),
  [0007](../../ADR/0007-simulator-node-adapter.md),
  [0008](../../ADR/0008-device-model-catalog.md),
  [0009](../../ADR/0009-real-crypto-15118.md),
  [0011](../../ADR/0011-no-reference-crypto-adapter.md), and
  [0012](../../ADR/0012-security-callback-model.md)

The complete exported API is in the TypeDoc output (`pnpm docs:api`).
