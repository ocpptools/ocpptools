---
'@ocpptools/core': minor
'@ocpptools/validator': minor
'@ocpptools/simulator': patch
---

Reject unsupported OCPP versions explicitly. Core adds `isOcppVersion` and an
`unsupported-version` inspection issue; the validator refuses OCPP 2.1.0 before
loading schemas; the simulator rejects a 2.1.0 snapshot protocol with a clear
error. OCPP 2.1.0 remains unimplemented.
