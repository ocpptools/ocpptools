# @ocpptools/schema-utils

Pure JSON Schema utilities for the OCPP Tools packages: draft normalization,
`$ref` resolution, field metadata, and payload defaults.

> **Status:** not released. This package is private and its API can still
> change. The conventions it follows are in
> [ADR 0002](https://github.com/ocpptools/ocpptools/blob/main/docs/ADR/0002-schema-utils-conventions.md).

It has no runtime dependencies. It does not use the DOM or Node APIs, and it
never reads files or the network. It does not validate data, it knows nothing
about OCPP, and it does not include any OCPP JSON Schema. Schemas are plain
values that you pass in. The Open Charge Alliance's own schemas, unmodified, are
in [`@ocpptools/schemas`](../schemas/README.md).

## The pipeline

Four steps turn a schema, in any of three drafts, into something a form or a
payload builder can use. Each step takes the output of the previous one.

```ts
import {
  applyDefaults,
  createEmptyPayload,
  getFields,
  normalizeSchema,
  resolveRefs,
} from '@ocpptools/schema-utils';

const heater = {
  $schema: 'http://json-schema.org/draft-04/schema#',
  id: 'urn:example:heater',
  type: 'object',
  definitions: { Mode: { type: 'string', enum: ['eco', 'boost'], default: 'eco' } },
  properties: {
    mode: { $ref: '#/definitions/Mode' },
    target: { type: 'number', minimum: 5, exclusiveMinimum: true, maximum: 30 },
  },
  required: ['mode', 'target'],
};

// 1. Convert draft-04, draft-06, or draft-07 to draft-07.
const normalized = normalizeSchema(heater);
if (!normalized.ok) throw new Error(normalized.error.message);
// normalized.value.schema has "$id" instead of "id", and
// "exclusiveMinimum: 5" instead of "minimum: 5, exclusiveMinimum: true".

// 2. Replace every $ref with the schema it points to.
const resolved = resolveRefs(normalized.value.schema, { dropDefinitions: true });
if (!resolved.ok) throw new Error(resolved.error.message);
const schema = resolved.value;

// 3. Describe the fields, for example to render a form.
const root = getFields(schema);
root.children?.map((field) => [field.name, field.kind, field.required]);
// [['mode', 'string', true], ['target', 'number', true]]

// 4. Build and complete payloads.
createEmptyPayload(schema); // { mode: 'eco' }
applyDefaults(schema, { target: 21 }); // { ok: true, value: { target: 21, mode: 'eco' } }
```

## Functions

| Function                           | Returns                         | Purpose                                                   |
| ---------------------------------- | ------------------------------- | --------------------------------------------------------- |
| `detectDraft(schema)`              | `SchemaDraft`                   | Reads the draft from `$schema`.                           |
| `normalizeSchema(schema, options)` | `Result<NormalizedSchema, ...>` | Converts draft-04 and draft-06 to draft-07.               |
| `resolveRefs(schema, options)`     | `Result<ResolvedJsonSchema,..>` | Inlines same-document `$ref`.                             |
| `getFields(schema, options)`       | `Field`                         | Describes a resolved schema as a tree of fields.          |
| `createEmptyPayload(schema, opts)` | `JsonValue \| undefined`        | Builds the required skeleton of a payload.                |
| `applyDefaults(schema, value)`     | `Result<JsonValue, ...>`        | Adds the `default` of each property missing from a value. |

Functions that take input from outside (`normalizeSchema`, `resolveRefs`,
`applyDefaults`) return a result: `{ ok: true, value }` or `{ ok: false, error }`.
The error has a `kind`, a `message`, and a `path` that is an array of segments
(a `string` for a property name and a `number` for an array index). No function
throws.

## What each step does

### `normalizeSchema`

- Draft-04 to draft-07: `id` becomes `$id`, a boolean `exclusiveMinimum` or
  `exclusiveMaximum` becomes the numeric form, and `$schema` is updated.
- Draft-06 to draft-07: only `$schema` changes. Draft-07 is returned as it is.
- Only schema positions are converted. A property called `id` or `type`, and
  the contents of `enum`, `default`, and unknown keywords, are data and stay.
- Unknown keywords such as `javaType` are kept. `stripUnknownKeywords: true`
  removes them for strict validators.
- A schema with an unsupported `$schema` is returned unchanged with an
  `unknown-draft` warning. A schema with no `$schema` is read as `defaultDraft`
  (draft-07 by default).
- It cannot rewrite one draft-04 rule: `1.0` is not an integer in draft-04 and
  is from draft-06 on.

### `resolveRefs`

- Only references inside the same document are followed (`#`,
  `#/definitions/Name`). An external reference is an error, and nothing is
  fetched.
- Siblings of `$ref` are ignored, as in draft-07. Only schema positions are
  read, so `$ref` inside `enum` or `default` is data.
- A cycle is an error (`circular-ref`), so a recursive schema such as a tree
  cannot be resolved.
- `maxDepth` (default 128, at most 256) and `maxNodes` (default 100000) bound
  the size of the result. Exceeding them is `limit-exceeded`. A schema is never
  cut short silently.
- Each use of a definition is its own copy. `dropDefinitions: true` removes
  `definitions` once they are inlined, and then does not check them.
- It does not read draft-04 `id`. Run `normalizeSchema` first.

### `getFields`

- Each field has a `path`, `name`, `required`, `kind`, `inferred`, `nullable`,
  `description` (as written), `format`, `pattern`, `enum` (with its JSON
  types), `default`, and the numeric constraints.
- An object has `children` in schema order. An array has `item` (one schema) or
  `tuple` (a list of schemas). The path of an `item` ends in `0`.
- A field with no `type` gets a kind from `properties`, `items`, or `enum`, and
  `inferred` is `true`.
- Composition (`allOf`, `anyOf`, `oneOf`), several types, unknown types, and the
  schema `false` give `kind: 'unsupported'` with a `reason`. Nothing is guessed.
- `omit(path)` leaves out properties, for example a field you do not want to
  show.

### `createEmptyPayload` and `applyDefaults`

- `createEmptyPayload` returns the required skeleton: required objects are
  expanded, required arrays are empty, and a required value is its `default`,
  else the first `enum` value, else it is left out. `fill: 'typed-zero'` uses
  `''`, `0`, or `false` instead. Properties that are not required are never
  included.
- `applyDefaults` copies a value and adds the `default` of each property that is
  missing. It never changes a property that is present (including `0`, `false`,
  `''`, and `null`), and never creates a parent object just to hold a default.

## The normalized schema contract

Other packages (the validator and the builder) rely on these guarantees. They
are covered by tests.

1. **Draft-07.** A successful `normalizeSchema` returns plain JSON in draft-07
   vocabulary. If the input was draft-04 or draft-06, `$schema` is the draft-07
   URI, even when the input had none. The only exception is a schema with an
   unsupported `$schema`, which is returned unchanged with a warning, so check
   `draft` and `warnings`.
2. **No `$ref`.** A successful `resolveRefs` returns a `ResolvedJsonSchema`: a
   tree with no `$ref` at any schema position and no cycles.
3. **Nothing is shared.** No function changes its input, and no result shares
   an object with its input or with another result. Inputs can be frozen.
4. **No location.** A schema is only ever a value you pass in. Nothing is read
   from a file, a URL, or a global.
5. **Stable.** The same input gives an equal result, and normalizing twice gives
   the same result as normalizing once.
6. **Results, not exceptions.** Input that is not JSON, not a schema, or cannot
   be resolved is reported with a `kind`, a `message`, and a `path`.

## Limits

- Only draft-04, draft-06, and draft-07. Newer drafts pass through unchanged.
- No anchors (`#foo`), no `$id`-based reference resolution, and no external
  references.
- No validation. Use a validator such as Ajv for that.
- Property names that look like array indexes (`"1"`, `"12"`) come first in
  `getFields`, because JavaScript orders object keys that way.

## License

Apache-2.0. See the repository `LICENSE` and `NOTICE`.
