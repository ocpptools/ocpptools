---
'@ocpptools/testing': patch
---

Ignore an unknown OCPP message type in the mock CSMS instead of replying with `CALLERROR MessageTypeNotSupported`, following OCPP 2.0.1 Errata 2026-09. With `replyToInvalidFrames` enabled, a malformed CALL with a readable message ID still receives the version-specific error code.
