---
'ocpptools': minor
---

Add the `ocpptools` CLI. It validates OCPP-J frames from a file or standard
input against the official schemas, and runs simulator scenarios in Node
against a CSMS. It uses the published validator and simulator APIs, defaults to
a no-interactive one-shot run, and reports machine-readable results with
`--json`.
