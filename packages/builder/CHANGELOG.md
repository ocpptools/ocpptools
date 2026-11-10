# @ocpptools/builder

## 0.1.0

### Minor Changes

- Add the headless schema-driven OCPP-J payload and frame builder. It
  normalizes draft-04/06/07 schemas, resolves local references with limits,
  describes fields, creates empty payloads and defaults, checks payloads
  structurally, builds CALL/CALLRESULT/CALLERROR frames, and serializes with
  `@ocpptools/core`. The package ships no OCA schemas, action lists, per-action
  types, examples, DOM, Tailwind, Ajv, or network access.
