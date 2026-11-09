# ocpptools

## 0.1.0

### Minor Changes

- 72f97f2: Add the `ocpptools` CLI. It validates OCPP-J frames from a file or standard
  input against the official schemas, and runs simulator scenarios in Node
  against a CSMS. It uses the published validator and simulator APIs, defaults to
  a no-interactive one-shot run, and reports machine-readable results with
  `--json`.

### Patch Changes

- Updated dependencies [13850e2]
  - @ocpptools/simulator@0.3.0
