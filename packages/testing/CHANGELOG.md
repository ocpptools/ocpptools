# @ocpptools/testing

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
