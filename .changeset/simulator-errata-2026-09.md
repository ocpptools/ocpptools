---
'@ocpptools/simulator': patch
---

Ignore an unknown OCPP message type instead of replying with `CALLERROR MessageTypeNotSupported`, following OCPP 2.0.1 Errata 2026-09. The error code stays accepted in `@ocpptools/core` so frames from older peers remain valid, but it is deprecated and new code should not send it.
