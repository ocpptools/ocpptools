# OCPP 2.0.1 errata review

- Date: 2026-11-11
- Edition reviewed: OCPP 2.0.1 Edition 4 FINAL (2025-12-03), including Errata
  2026-09.
- Scope: the RPC and JSON Schema layers that this repository implements. The
  repository does not implement a complete charging station or CSMS state
  machine.

## Sources

- Open Charge Alliance, OCPP 2.0.1 Edition 4, Errata 2026-09
  (`OCPP-2.0.1_edition4_errata_2026-09.pdf`), Part 3 (no new errata) and Part 4,
  items 4.1 to 4.3.
- The official package `OCPP-2.0.1_all_files.zip`, downloaded on 2026-11-01.
  [`packages/schemas/SOURCES.md`](../packages/schemas/SOURCES.md) records the
  URL, the date, and the SHA-256.

## Part 3 JSON Schemas

Errata 2026-09 says: "Currently no new errata for OCPP 2.0.1 part 3." The
schemas are dated 2020-03-31, and neither Edition 4 nor the 2026 errata changed
them. `@ocpptools/schemas` 0.1.0 therefore remains the current Part 3 copy. See
[ADR 0003](ADR/0003-oca-json-schemas.md).

Consequences:

- `@ocpptools/validator` payload validation is unchanged.
- No `@ocpptools/schemas` release is needed.
- The draft-06 suite in `packages/validator/test/draft06.test.ts` covers
  selected draft-06 keywords (`$ref`, `const`, `contains`, `propertyNames`,
  numeric `exclusiveMinimum` and `exclusiveMaximum`, `dependencies`, and
  `$id`) plus `required`, `additionalItems`, `format`, and boolean schemas. It
  does not claim to cover every keyword or every keyword the OCA schemas use.

## Part 4 RPC changes

1. Item 4.1 (page 10): the sentence about unknown message types is clarified.
   A system must ignore the entire message, not only its payload.
2. Item 4.2 (page 16): `MessageTypeNotSupported` is deprecated. A message type
   that is not supported is silently ignored.
3. Item 4.3 (page 16): the section 4.4 extension fallback mechanism is removed
   because it contradicts section 4.1.

Impact:

| Component              | Change                                                                                                                                                              |
| ---------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `@ocpptools/core`      | `MessageTypeNotSupported` stays in the 2.0.1 code set so frames from older peers remain valid. The README marks it deprecated.                                      |
| `@ocpptools/simulator` | An unknown message type is ignored: the parse error and a warning are logged locally, and the simulator no longer replies with `CALLERROR MessageTypeNotSupported`. |
| `@ocpptools/testing`   | The mock CSMS ignores an unknown message type even with `replyToInvalidFrames: true`. Malformed CALL frames still receive the version-specific error code.          |
| `@ocpptools/validator` | Frame inspection still reports an unsupported message type locally. It does not answer the peer, so the errata does not change its API.                             |
| `ocpptools` CLI        | Inherits the core code set and the validator behavior; no separate change.                                                                                          |

Regression tests:

- `packages/core/test/error-codes.test.ts` keeps the code accepted and records
  the deprecation.
- `packages/simulator/test/rpc.test.ts` asserts that neither 1.6J nor 2.0.1
  sends a response to an unknown message type.
- `packages/testing/test/mock-csms.test.ts` asserts that the mock CSMS does not
  reply to an unknown message type but still answers a malformed CALL.

## Out of scope

- **Part 2** contains requirement, use-case, and device-model clarifications.
  Examples include the `evseId` requirements for `RequestStartTransaction`,
  `RemoteStartWithoutEvseId`, and the new `DisabledIdTokenTypes` variable. They
  do not change the Part 3 schemas or the CALLERROR set. The simulator is not a
  complete charging station state machine, so it does not implement them.
- **Parts 5 and 6** are certification profiles and test cases. They do not
  change the wire format.
- If a later errata changes a payload, a frame, or an error code, add a
  regression test and a changeset in the same pull request.

## Next review

Review again when the OCA publishes a new OCPP 2.0.1 edition or errata, or by
2027-01-31, whichever comes first.
