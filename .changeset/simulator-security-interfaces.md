---
'@ocpptools/simulator': minor
---

Add `SecurityOptions201` to the 2.0.1 simulator. Consumers can opt into real
certificate validation by injecting `validateCertificateChain`, or keep the
default simulated behavior. The engine stays free of crypto dependencies; its
security state never stores private keys. Snapshots with `includeHistory` can
retain raw inbound frames in diagnostic history, so callers must redact history
before saving or exporting sensitive material.
