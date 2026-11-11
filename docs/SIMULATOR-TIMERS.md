# Simulator timer limits

- Date: 2026-11-11
- Scope: `@ocpptools/simulator` 1.6J and 2.0.1.

JavaScript timers cannot schedule more than the signed 32-bit maximum
(2,147,483,647 ms). The simulator re-arms long timers instead of dropping them.

| Location                                                             |      Cap (ms) | Behavior                                                                  |
| -------------------------------------------------------------------- | ------------: | ------------------------------------------------------------------------- |
| 1.6 reservation expiry (`profiles/1.6/index.ts`)                     | 2,147,483,647 | Re-arms until the expiry, then expires the reservation.                   |
| 2.0.1 local-auth reservation expiry (`profiles/2.0.1/local-auth.ts`) | 2,147,483,647 | Re-arms until the expiry.                                                 |
| 2.0.1 services (`profiles/2.0.1/services.ts`)                        | 2,147,000,000 | Re-arms until the firmware or log target, then runs the service callback. |

The 2.0.1 services cap is 483,647 ms below the signed 32-bit maximum. The
difference is a safety margin, not a protocol rule. The observable behavior is
the same in both cases: the timer is re-armed and the action happens at the
target time.

## Tests

- `packages/simulator/test/engine-16-semantics.test.ts` covers a 1.6
  reservation beyond the cap and re-arming.
- `packages/simulator/test/engine-201-local-auth.test.ts` covers a 2.0.1 local
  auth reservation beyond the cap.
- `packages/simulator/test/engine-201-services.test.ts` covers a 2.0.1 firmware
  timer beyond the 2,147,000,000 ms cap, and asserts that `dispose()` leaves
  zero pending timers.

## Other limits

- `duration`, `startSchedule`, `recurrencyKind`, `numberPhases`, and
  `minChargingRate` are validated by the charging profile tests in
  `engine-16-semantics.test.ts`, `engine-201-charging.test.ts`, and
  `engine-201.test.ts`.
- Stacked profiles, priority, validity windows, and expiry are covered by the
  same suites.
- The injected clock is the only source of time; the tests advance it and check
  the re-arm behavior. No wall-clock timers are used.
