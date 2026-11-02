# 0002. schema-utils conventions

- Status: accepted
- Date: 2026-11-01

## Context

`@ocpptools/schema-utils` holds the JSON Schema logic that `validator` and
`builder` share: normalizing older drafts, resolving references, describing
fields, and building payloads. Both packages need it at runtime, so its API and
its failure behavior become part of theirs. Several choices are expensive to
change once it is published: which types it exposes, how it reports failure,
how it treats `$ref` and unknown input, what "empty payload" and "defaults"
mean, and how it ships.

The package works on JSON Schema structure only. It does not know OCPP.
Whether OCA JSON Schemas may be distributed with this project is a separate
question and is not decided here; ADR 0003 decides it.

## Decision

1. **Pure and protocol-agnostic.** The package has no runtime dependencies and
   uses no DOM, Node, network, file system, `Date`, or randomness. Functions do
   not mutate their input and the package keeps no module-level state. It
   knows nothing about OCPP versions, actions, or fields such as `customData`;
   callers pass such rules as options.
2. **Own JSON types, no dependency on `core`.** `schema-utils` declares its own
   `JsonValue`, `JsonObject`, `JsonSchema`, and result types. They are
   structurally compatible with the ones in `core`. A dependency on `core`
   would force a `schema-utils` release for every 0.x minor of `core`, for
   types that rarely change.
3. **Failures that depend on the schema are results.** Resolving references
   returns `{ ok: true, value }` or `{ ok: false, error }`, as in ADR 0001. The
   error kinds are `invalid-schema`, `unresolved-ref`, `external-ref`,
   `circular-ref`, `invalid-pointer`, and `limit-exceeded`, each with the path
   and the reference that caused it. Normalizing returns a result too, with the
   single kind `invalid-schema`, for input that is not a JSON schema (not JSON,
   or not an object or a boolean). Applying defaults to a value does the same
   with the kind `invalid-value`, because the value comes from outside.
   Describing fields and building an empty payload take a schema that has
   already been checked and are total. No function throws.
4. **Normalize to draft-07.** `normalizeSchema` accepts draft-04, draft-06, and
   draft-07, and returns draft-07 plus a list of warnings, in a result.
   - Draft-04 to draft-07: `id` becomes `$id`, `$schema` is updated, and the
     boolean `exclusiveMinimum` and `exclusiveMaximum` become numeric.
   - Draft-06 to draft-07: only `$schema` changes.
   - The walk follows schema positions (`properties`, `items`, `definitions`,
     and the other schema-bearing keywords), never key names, so a property
     called `id` or `type` is left alone.
   - A schema with no `$schema` is treated as `defaultDraft` (draft-07 by
     default). A newer draft is returned unchanged with a warning.
   - Keywords that are not part of the draft, such as `javaType`, are kept.
     `stripUnknownKeywords` removes them for strict validators.
   - Normalizing twice gives the same result as normalizing once. A schema read
     as draft-04 or draft-06 gets a draft-07 `$schema`, even when it had none,
     so the result says what it is.
5. **References are local and checked.** Only same-document references are
   resolved (`#`, `#/definitions/...`). An external reference is an error and
   nothing is fetched. Siblings of `$ref` are ignored, as in draft-07. Cycles
   are detected by tracking the references being resolved, not by a depth
   limit. `maxDepth` and `maxNodes` are configurable budgets that return
   `limit-exceeded`. A schema is never truncated silently. The raw schema type
   (may contain `$ref`) and the resolved schema type (contains none) are
   distinct, and field description accepts only the resolved one.
6. **Field metadata is a tree with segment paths.** Paths are arrays of
   segments, `string` for a property name and `number` for an array index,
   never dotted strings, so names containing dots or digits are unambiguous.
   Order follows the schema. Enums keep their value types. When `type` is
   missing, the kind is inferred and the node is marked as inferred.
   `oneOf`, `anyOf`, and `allOf` produce an `unsupported` node instead of a
   guess. Descriptions are returned as written; presentation is the caller's
   concern.
7. **Payloads and defaults are explicit.** `applyDefaults` is a separate call
   and only fills properties that are absent, like Ajv's `useDefaults`. It
   never creates a parent object just to hold a default and never overwrites a
   present value, including `0`, `false`, and `''`. A default that is an object
   gets the defaults of its own properties. `createEmptyPayload` builds the
   required skeleton only: required objects are expanded, required arrays are
   empty, and a required leaf takes its `default`, else the first `enum` value,
   else is omitted, except `null`, which is always `null`. The option
   `fill: 'typed-zero'` uses `''`, `0`, or `false` instead of omitting. Nothing
   applies defaults implicitly.
8. **Hostile input is data.** Property names such as `__proto__`,
   `constructor`, and `prototype` are copied as ordinary keys and never
   assigned in a way that changes a prototype. The package has no
   `structuredClone` available (`lib: ES2022`, no DOM or Node typings), so it
   uses its own clone.
9. **Packaging.** The package starts `private: true`, because `changeset
publish` publishes any non-private package whose version is not on npm. It
   is made public when a published package depends on it. It is then published
   as 0.x, not embedded in `validator` and `builder`, and joins the `fixed`
   version group with them. Embedding would need a bundler and duplicate the
   code.
10. **Tests use synthetic schemas.** Fixtures are written for the tests, with
    ids such as `urn:example:...`. No OCA schema, or a copy of its structure
    and descriptions, enters the repository, and `pnpm lint:schemas` enforces
    the part it can check.

## Consequences

- `validator` and `builder` get one tested behavior for drafts, references,
  fields, and defaults, and no schema is cut off without an error.
- Callers handle reference errors explicitly and choose whether to apply
  defaults. Neither happens by accident.
- The package duplicates a few type declarations from `core`. They must stay
  structurally compatible by hand.
- Publishing a new package needs a first release with a token, because the npm
  trusted publisher requires the package to exist. Provenance for that release
  should be working beforehand.
- The version of `schema-utils` is tied to `validator` and `builder` through
  the `fixed` group once they exist.
- Out of scope: Ajv or any validation, OCPP knowledge, per-action types,
  fetching external references, JSON Schema drafts newer than draft-07, and
  the decision on distributing OCA schemas.
