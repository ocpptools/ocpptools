---
'@ocpptools/simulator': minor
---

Add the Node adapter in `@ocpptools/simulator/node`: a WebSocket transport
backed by the Node 22 built-in implementation, `nodeClock`, an in-memory
`Storage`, and an atomic file-backed `Storage` that hashes keys and retries
transient rename errors. The package still depends only on `@ocpptools/core` at
runtime.
