# 0013. Builder API, schema boundary, and versioning

- Status: accepted
- Date: 2026-11-09

## Context

Phase 5 extracts a headless, schema-driven message builder from the private
website. The website builder currently mixes a reusable schema/payload model
with DOM rendering, array-form state, examples, and Tailwind presets. The public
package must keep the reusable part and leave the UI in the website.

ADR 0004 forbids shipping per-action payload types, action lists, or field
lists derived from the Open Charge Alliance (OCA) JSON Schemas. ADR 0003 allows
unmodified copies of the schemas in `@ocpptools/schemas` and in-memory
transformation in the caller's process. ADR 0002 defines the `schema-utils`
pipeline and puts the builder in the Changesets fixed group. The builder does
not exist yet, so its first release needs an explicit versioning decision.

## Decision

1. **Headless and schema-driven.** `@ocpptools/builder` constructs payloads and
   OCPP-J frames from a schema registry supplied by the caller. It has no DOM,
   Node, network, file system, Tailwind, UI framework, or ambient time
   dependency. It works in browsers and Node 22.12+.

2. **The caller owns the schema source.** `BuilderSchemaRegistry.get(action,
kind)` returns a schema or a promise of one. An optional `actions()` method
   is only a view of what the registry exposes; when absent, `listActions()`
   returns an empty list. The package ships no schema, action list, per-action
   type, or example derived from the OCA schemas.

3. **Runtime metadata is allowed, redistribution is not.** `fields()` returns
   `Field` metadata (descriptions, enums, defaults, constraints) computed in the
   caller's process from the schema the caller supplied, following ADR 0003.
   The package does not ship that metadata. Tests use synthetic schemas and
   payloads; integration tests may load `@ocpptools/schemas` at runtime as data,
   but no generated schema, field, or payload fixture is committed. README
   examples use a synthetic schema or load the schemas at runtime.

4. **Structural checks only.** `buildPayload` checks required properties, JSON
   types, enums, numeric bounds, string lengths, array bounds, and nullable
   values. It does not implement JSON Schema: `allOf`, `anyOf`, `oneOf`,
   `additionalProperties`, `pattern`, `format`, and unlisted keywords are not
   enforced. A successful build means structurally plausible, not
   schema-valid, conformant, or safe. Full validation remains in
   `@ocpptools/validator`. `pattern` and `format` are deliberately not
   evaluated to avoid ReDoS from caller-supplied schemas. Schema and payload
   depth/node budgets bound the work.

5. **Frames come from `core`.** The builder produces CALL, CALLRESULT, and
   CALLERROR frames and delegates serialization to `@ocpptools/core`. It does
   not duplicate frame parsing, message IDs, or version-specific error codes.
   Message IDs are injectable and default to the core UUID generator.

6. **The caller must match the registry version.** `version` on
   `BuilderOptions` selects draft defaults and error-code checks. The builder
   cannot verify that the registry contains schemas for the same OCPP version;
   the caller is responsible for that match.

7. **Versioning.** `@ocpptools/builder` is versioned independently and starts at
   `0.1.0`. It is not added to the Changesets `fixed` group. This supersedes only
   the part of ADR 0002 point 9 that puts the builder in that group, and the
   consequence that the version of `@ocpptools/schema-utils` is tied to the
   builder through it. The rest of ADR 0002 point 9 remains in force:
   `schema-utils` is published, is not embedded in the builder, and is a runtime
   dependency. The fixed group remains `core`, `schema-utils`, and `validator`
   (ADR 0005 point 12). Because `schema-utils` stays in the group, a group
   release that moves it outside the builder's declared 0.x range still releases
   the builder through Changesets. This follows the simulator's independent
   versioning (ADR 0006 point 9) and is a deliberate exception for a new package
   with its own API cadence, not a change to the fixed group. Adding the builder
   to the fixed group later requires a new ADR.

8. **No version subpaths in 0.1.0.** A single root entry takes `version: '1.6' |
'2.0.1'`. There is no per-version code that needs `./1.6` or `./2.0.1`
   entries. OCPP 2.1.0 remains deferred (ADR 0010).

9. **Publication is conditional on the clean split.** The package is scaffolded
   `private: true` at `0.0.0` until the headless API, tests, bundle check, pack
   smoke, and the website parity gate pass. The release PR removes `private` and
   publishes `0.1.0` as alpha. If the split cannot be kept clean, the package
   stays internal. The private website builder is the intended first consumer,
   but the package does not depend on it.

10. **Legal and packaging boundary.** The package is Apache-2.0. The tarball
    contains `dist`, `package.json`, `NOTICE`, and the README; it contains no OCA
    schema, Ajv, DOM, Node, tests, or generated action/field list.
    `@ocpptools/schemas` and `@ocpptools/validator` are devDependencies only.
    The README and NOTICE carry the OCA attribution and non-affiliation notice.

11. **Type boundary.** The builder imports `JsonObject` from `@ocpptools/core`
    and `Field`/`Path` from `@ocpptools/schema-utils`, whose JSON types remain
    structurally compatible by hand (ADR 0002 point 2). Public boundaries use
    `unknown`, not `any`.

## Consequences

- Consumers get a small reusable model with no UI or schema redistribution.
- A successful build does not validate; consumers must run the validator for
  full JSON Schema checks.
- The builder can evolve on its own release cadence, but a `schema-utils` range
  change can still force a builder release through Changesets.
- The website keeps DOM rendering, form state, examples, and Tailwind presets;
  it loses the duplicated schema resolver and payload model.
- A future complete JSON Schema implementation, action list, or generated types
  needs a new ADR and legal review.
