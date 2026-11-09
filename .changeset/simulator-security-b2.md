---
'@ocpptools/simulator': minor
---

Extend the opt-in 2.0.1 security integration with a CSR provider and
revocation checks. `certificates.signWithProvider` generates a CSR without
leaking private keys, `revocation` validates a real `CertificateSigned` chain
with an explicit unknown-result policy, and `callbackTimeoutMs` bounds every
injected security callback. Raw certificate requests now reject private-key
material and malformed CSRs before sending. A signed chain without
`certificateType` is stored for both uses, and a rejected real chain emits
`InvalidChargingStationCertificate`.
