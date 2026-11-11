# Simulator reconnection policy

- Date: 2026-11-11
- Scope: `@ocpptools/simulator` 1.6J and 2.0.1.
- Trigger: an abnormal transport close (`code !== 1000`). The connection retries
  with exponential backoff (default: 1 s, 2 s, ... up to 30 s, five attempts).
  A clean close stops the connection.

On every new transport the engine sends `BootNotification` when automatic boot
is enabled (the default), then the profile `onReady` sends the status
notifications and restarts the meter loops for active transactions. The state
below is in memory and survives the reconnect.

| Feature                   | Policy                                                                                                                                                                                                                                                              | Test                                                                                                                 |
| ------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | -------------------------------------------------------------------------------------------------------------------- |
| Active transaction        | Kept. The simulator does not synthesize `Ended` because a reconnect does not prove that the transaction ended. Meter loops resume for a 1.6 connector in `Charging` and for any 2.0.1 EVSE with a transaction. `stopTransaction`/`stop` remains the explicit close. | `packages/simulator/test/engine-reconnect.test.ts` ("keeps a 1.6 transaction..." and "keeps a 2.0.1 transaction...") |
| Offline queue             | Enqueued with `sendOrQueue`/`queueCall` while disconnected; flushed once after boot accepted, with the original message IDs.                                                                                                                                        | `engine-reconnect.test.ts` ("...flushes the queue once")                                                             |
| Local auth and cache      | Version and entries are kept.                                                                                                                                                                                                                                       | `engine-reconnect.test.ts` ("keeps 1.6 local auth..." and "keeps 2.0.1 local auth...")                               |
| Reservations              | Kept; reservation timers are re-armed after boot.                                                                                                                                                                                                                   | state-preservation tests; timer re-arm is in `engine-16-semantics.test.ts` and `engine-201-local-auth.test.ts`       |
| Charging profiles         | Kept. The composite schedule is derived from the kept state when requested.                                                                                                                                                                                         | state-preservation tests; composite coverage is in `engine-16-semantics.test.ts` and `engine-201-charging.test.ts`   |
| Monitoring                | Monitors are kept; monitoring timers are re-armed.                                                                                                                                                                                                                  | 2.0.1 state-preservation test                                                                                        |
| Pending resets            | Kept. An `OnIdle` reset waits for the active transaction and then reboots.                                                                                                                                                                                          | `engine-reconnect.test.ts` ("keeps a pending 2.0.1 OnIdle reset...")                                                 |
| Security and certificates | The simulated security state and certificates are part of the engine state and are not cleared on transport close. Callbacks and trust stores are configuration, not connection state.                                                                              | snapshot coverage in `engine-201-security-persistence.test.ts`; the reconnection path does not touch this state      |
| Metrics and history       | Metrics are not reset. History appends one `BootNotification` per session; the queued call is replayed once.                                                                                                                                                        | `engine-reconnect.test.ts` ("does not duplicate history..." and the queue tests)                                     |

## Notes

- `handleTransportClose` cancels meter loops and 2.0.1 monitoring timers, and
  resets in-flight RPC calls. It does not clear transactions, profiles,
  reservations, monitoring data, local auth, or security state.
- A 2.0.1 CSMS can reconcile an uncertain transaction with
  `GetTransactionStatus`; the simulator answers from the preserved state.
- If a consumer needs a transaction to end on reconnect, call the transaction
  API explicitly. The simulator does not guess.
