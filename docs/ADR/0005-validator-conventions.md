# 0005. Validator conventions

- Status: proposed
- Date: 2026-11-02

## Context

`@ocpptools/validator` checks OCPP-J frames and their payloads for OCPP 1.6J and
2.0.1. It is the first package that runs a JSON Schema validator (Ajv), and the
first that needs the OCPP JSON Schemas at runtime, which it must not ship (ADR
0003 and ADR 0004). Its API and its results become part of every tool built on
it, so several choices are expensive to change after the first release: where
the structural checks live, whether the API is synchronous, how schemas reach
the validator, how Ajv is configured, and what a result looks like.

Facts that shape the design:

- Ajv 8 ships the draft-07 meta-schema only. The 1.6J schemas are draft-04 and
  the 2.0.1 schemas are draft-06, so they are normalized first with
  `@ocpptools/schema-utils`.
- In strict mode Ajv rejects `additionalItems` next to a single `items` schema,
  which the 2.0.1 schemas use. The `strictSchema` option controls that check.
- The 2.0.1 schemas carry keywords that are not part of JSON Schema
  (`javaType`, `comment`).
- Ajv compiles schemas into JavaScript with `new Function`, which a Content
  Security Policy without `unsafe-eval` blocks.
- Ajv and `ajv-formats` together add about 33 kB (brotli) to a browser bundle.

## Decision

1. **Scope.** The validator checks the structure of a frame, the CALLERROR code
   for the version, and the payload of a CALL or CALLRESULT against its schema.
   It has no UI and uses no DOM or Node APIs. It contains no OCPP schema and no
   list of actions.
2. **Structural checks live in `core`.** `core` gains a function that inspects
   a parsed frame and reports every structural problem, not only the first.
   `parseFrame` keeps its behavior. The validator uses that function, so the
   structural rules exist in one place.
3. **The API is asynchronous.** `createValidator({ version, schemas })` returns
   an object whose `validateFrame(input, options)` and
   `validatePayload(action, kind, payload)` return promises. Schemas can then be
   loaded on demand with a dynamic `import()`.
4. **Schemas come from a registry the caller provides.** A registry answers
   `get(action, kind)` with a schema, `undefined`, or a promise of either. A
   helper builds one from a `load(fileName)` function and the file naming of the
   official packages (1.6J: `Action.json` and `ActionResponse.json`; 2.0.1:
   `ActionRequest.json` and `ActionResponse.json`). The caller may also pass the
   file names that exist, so an unknown action is distinguished from a failed
   load without the package holding a list of actions. Nothing in the package
   lists the actions: an action is known when the registry has a schema for it.
5. **Schemas are prepared and compiled on first use.** Each schema is
   normalized with `normalizeSchema` (unknown keywords removed) and compiled the
   first time its action and kind are needed. Ajv resolves `$ref` inside the
   schema itself. Compilation is cached per action and kind, including while it
   is in progress. `addUsedSchema` is off, so compiled schemas are not registered
   by `$id`; each schema must be self-contained, and a `$ref` to another supplied
   schema by `$id` is not supported.
6. **Ajv configuration.** `allErrors` is on, so every problem is reported.
   `strictSchema` is off, because of the `additionalItems` pattern above. The
   other strict checks keep their default log mode, and `logger` is off. Formats
   come from `ajv-formats`. `multipleOfPrecision` is `6`, so decimal
   `multipleOf` values are not rejected by floating point error. Only own
   properties count. The validator never coerces types or inserts defaults:
   validating does not change data. The `new Function` limitation is documented,
   and precompiled validators are left for later.
7. **Results are a stable model of the package's own.** A result is one of
   `valid`, `invalid-frame`, `unknown-action`, `schema-missing`, or
   `invalid-payload`, with a list of issues and a list of warnings. An issue has
   a path as segments (a string for a property, a number for an index), a JSON
   pointer, a message written by this package, the JSON Schema keyword when
   there is one, and short `expected` and `received` texts. Ajv's error objects
   and messages are not exposed, so an Ajv upgrade does not change results.
   `received` is truncated so a large payload does not end up in the result.
8. **One validator per OCPP version.** Each has its own Ajv instance and cache.
9. **A CALLRESULT needs its request.** A CALLRESULT does not name its action, so
   `validateFrame` takes the action of the request as an option. Without it, the
   payload is not checked and the result carries a warning. Matching responses to
   requests by message ID belongs to the simulator.
10. **Warnings do not invalidate.** A message ID longer than 36 characters and
    an unchecked CALLRESULT are warnings.
11. **Dependencies.** `ajv` (^8), `ajv-formats` (^3), `@ocpptools/core`, and
    `@ocpptools/schema-utils`. `@ocpptools/schemas` is only used by the tests and
    in the documentation, so users can bring schemas from anywhere.
12. **Versioning.** `core`, `schema-utils`, and `validator` form a fixed version
    group in Changesets. `@ocpptools/schemas` stays outside it, because its
    versions follow the editions of the Open Charge Alliance.

## Consequences

- Validating needs `await`, also when every schema is already loaded.
- A browser application pays about 33 kB (brotli) for Ajv and its formats, plus
  only the schemas of the actions it validates.
- Applications with a strict Content Security Policy cannot use the validator
  until precompiled validators exist.
- `core` grows by one function before 1.0, and its version moves with the
  validator's.
- Every message of both versions is tested against the official schemas,
  read from `@ocpptools/schemas` at test time and never copied into the tests.
- A schema that references another supplied schema by `$id` is not supported:
  each schema must be self-contained.
- Out of scope: schemas bundled in the package, generated payload types,
  OCPP 2.1, and validation of a CALLRESULT without its request.
