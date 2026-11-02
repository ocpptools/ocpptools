---
'@ocpptools/core': minor
---

Add `inspectFrame`, which reports every structural problem of a parsed frame instead of stopping at the first one, with a path, a message, and expected and received texts for each. It applies the same rules as `parseFrame`, warns about message IDs longer than 36 characters (`MAX_MESSAGE_ID_LENGTH`), and can check a CALLERROR error code against an OCPP version. `parseFrame` does not change.
