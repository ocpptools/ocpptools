---
'@ocpptools/core': minor
---

Add `serializeFrame`, which turns an `OcppFrame` into compact JSON text and returns a `Result` instead of throwing. It rejects values JSON cannot represent and anything that is not a well-formed frame, so its output always parses back with `parseFrame`. Also add `createMessageIdGenerator` for random UUID message IDs, with the `MessageIdGenerator` and `RandomUuidSource` types for injecting a custom source.
