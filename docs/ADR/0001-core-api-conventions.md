# 0001. Core API conventions for 0.1.0

- Status: accepted
- Date: 2026-10-31

## Context

`@ocpptools/core` is the base of every other package. Four choices shape its
public API and are expensive to change once 0.1.0 is published: how payloads
are typed, how boundary functions report failure, how message IDs are
generated, and how the first release is published.

## Decision

1. **Payloads are `JsonObject`.** Frames carry `JsonObject` payloads. 0.1.0
   ships no per-action payload types. Generating them from the OCA JSON Schemas
   is blocked on the schema license review, and per-action types can be added
   later without breaking the frame types.
2. **Boundary functions return results.** `parseFrame` and `serializeFrame`
   return a discriminated result (`{ ok: true, ... }` or `{ ok: false, error }`)
   and do not throw for failures that depend on their input. Parsing is strict:
   it distinguishes a malformed frame, an unknown message type, and an invalid
   payload. An unknown CALLERROR error code is not a parse failure; callers can
   check it with a separate helper.
3. **Error codes are per version.** OCPP 1.6J and 2.0.1 keep separate error
   code sets, with the 1.6J spelling `OccurenceConstraintViolation` preserved.
   There is no merged union.
4. **Message IDs default to UUIDs.** The default generator uses
   `crypto.randomUUID()`, which yields 36 characters, the maximum length of an
   OCPP message ID. The generator is injectable so tests can be deterministic.
   The package targets `lib: ES2022` without DOM or Node typings, so it declares
   the minimal structural types it needs instead of importing them.
5. **Publishing stays CI-only.** Releases come from the release workflow with
   provenance. How the very first release authenticates is settled before the
   release workflow is enabled, after checking the current npm trusted
   publishing documentation. Preferred approach: a single-use, narrowly scoped
   token in the `release` environment, revoked once the trusted publisher is
   configured.

## Consequences

- Consumers get precise frame types and no `any` at the boundary, but must
  narrow payloads themselves until per-action types exist.
- Callers handle results explicitly, so a malformed frame from a peer or a
  user-edited payload cannot crash a simulator.
- The 1.6J and 2.0.1 error code sets must be kept in sync with the
  specifications by hand.
- `core` stays free of Ajv, DOM, and Node typings. Environments without
  `crypto.randomUUID` must supply their own generator.
- Per-action payload types, action-name lists, and schema validation are out of
  scope for 0.1.0.
