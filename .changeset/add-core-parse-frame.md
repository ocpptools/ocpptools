---
'@ocpptools/core': minor
---

Add `parseFrame`, which parses an OCPP-J text frame into a typed `OcppFrame` and returns a `Result` instead of throwing. A rejected frame reports a `malformed`, `unknown-message-type`, or `invalid-payload` error, with the message ID when it could be read. Also add the `Result` type.
