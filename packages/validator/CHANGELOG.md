# @ocpptools/validator

## 0.3.0

### Minor Changes

- 055a0ab: Reject unsupported OCPP versions explicitly. Core adds `isOcppVersion` and an
  `unsupported-version` inspection issue; the validator refuses OCPP 2.1.0 before
  loading schemas; the simulator rejects a 2.1.0 snapshot protocol with a clear
  error. OCPP 2.1.0 remains unimplemented.

### Patch Changes

- Updated dependencies [055a0ab]
  - @ocpptools/core@0.3.0
  - @ocpptools/schema-utils@0.3.0

## 0.2.0

### Minor Changes

- 7a5220d: First public release of `@ocpptools/schema-utils` and `@ocpptools/validator` at 0.2.0, in the fixed version group with `@ocpptools/core` 0.2.0. The validator validates OCPP 1.6J and 2.0.1 frames and payloads with a lazy schema registry, Ajv, and readable issues. The schema utilities provide draft normalization, `$ref` resolution, field metadata, and payload defaults.

### Patch Changes

- Updated dependencies [a78fa4b]
- Updated dependencies [7a5220d]
  - @ocpptools/core@0.2.0
  - @ocpptools/schema-utils@0.2.0
