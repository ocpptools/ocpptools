# @ocpptools/schema-utils

## 0.3.1

### Patch Changes

- a9b83f6: Strip keywords introduced after the input draft when `stripUnknownKeywords` is set. A draft-06 schema now drops `if`/`then`/`else`, `$comment`, `readOnly`, `writeOnly`, and the content keywords, and a draft-04 schema also drops `const`, `contains`, `examples`, and `propertyNames`. This makes normalization conformant for Ajv instead of enforcing draft-07 keywords that the source draft ignores.

## 0.3.0

No changes in this release.

## 0.2.0

### Minor Changes

- 7a5220d: First public release of `@ocpptools/schema-utils` and `@ocpptools/validator` at 0.2.0, in the fixed version group with `@ocpptools/core` 0.2.0. The validator validates OCPP 1.6J and 2.0.1 frames and payloads with a lazy schema registry, Ajv, and readable issues. The schema utilities provide draft normalization, `$ref` resolution, field metadata, and payload defaults.
