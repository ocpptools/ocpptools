# 0004. Per-action payload types

- Status: accepted
- Date: 2026-11-02

## Context

`@ocpptools/core` types the OCPP-J frames but not the payloads. ADR 0001 made
payloads `JsonObject` and left per-action types for later, because generating
them from the Open Charge Alliance (OCA) JSON Schemas was blocked on the license
review. Users would like typed payloads, for example the fields of a
`BootNotification`.

ADR 0003 settled the license question for the schemas: they are the OCA's work,
under CC BY-ND 4.0, and the project shares only unmodified copies of them.
CC BY-ND lets anyone produce and use adapted material for themselves but does
not let anyone share it. Types generated from the schemas, and lists of
actions or fields extracted from them, are derived from the schemas. Published
in a package, they would be shared adapted material.

The same reasoning kept `schema-utils` and the validator free of schemas: they
read schemas that the user passes in and transform them in memory, in the
user's own process.

## Decision

1. **No package ships per-action payload types or action lists derived from
   the OCA schemas.** This covers `core`, `schema-utils`, the validator, the
   simulator, the builder, and any later package. `@ocpptools/schemas` keeps
   the files unmodified and contains no types.
2. **Payloads stay `JsonObject`.** The frame types of `core` already take the
   payload type as a parameter (`CallFrame<Action, Payload>`), so code that has
   its own types can use them without any change to `core`.
3. **Users who want typed payloads generate them for themselves** from the
   schemas, which they can read from `@ocpptools/schemas` or download from the
   OCA, with any JSON Schema to TypeScript generator. The output stays in their
   project and is not redistributed. A command-line tool of this project may
   run such a generator locally in a later phase, and it must not publish the
   result.
4. **Hand-written types need a decision first.** Types that we write by hand
   for a small set of messages are our own text, not copies of the schema
   files. Whether they count as material adapted from the specification is a
   legal question, so they are added only if a real consumer asks for them and
   only after the maintainers have recorded the answer, ideally with the OCA's
   confirmation.
5. **The packages find actions in what they are given.** A validator, builder,
   or simulator learns the available actions from the schema registry it
   receives, not from a list built into the package.

## Consequences

- Users get no editor autocompletion for payloads out of the box. They can get
  it by generating types locally.
- The packages stay free of anything derived from the OCA schemas, so the
  decision in ADR 0003 covers all of them.
- Examples and tests that need payloads write small payloads by hand, as
  synthetic data.
- If the OCA allows derived artifacts, a new ADR can replace this one without
  breaking `core`, because adding types does not change the frame types.
