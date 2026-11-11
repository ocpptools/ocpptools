# @ocpptools/testing

## 0.1.2

### Patch Changes

- a9b83f6: Ignore an unknown OCPP message type in the mock CSMS instead of replying with `CALLERROR MessageTypeNotSupported`, following OCPP 2.0.1 Errata 2026-09. With `replyToInvalidFrames` enabled, a malformed CALL with a readable message ID still receives the version-specific error code.
- @ocpptools/core@0.3.1

## 0.1.1

### Patch Changes

- f673012: Validate the trusted publisher with an OIDC patch release.

## 0.1.0

### Minor Changes

- Publish the alpha test utilities package: a protocol-level mock CSMS, an
  in-memory transport pair/hub/factory, deterministic frame factories, synthetic
  fixtures, and a fake clock. The package has no OCA schema data, no default
  OCPP responses, no Ajv, `ws`, DOM, or Node runtime dependency beyond
  `@ocpptools/core`.
