---
'@ocpptools/simulator': minor
---

Add opt-in firmware verification to the 2.0.1 security integration. With a
`firmwareVerifier`, `UpdateFirmware` validates the request metadata, checks the
signing certificate when a validator is configured, optionally revocation-checks
it, and verifies the simulated download afterwards (`SignatureVerified`,
`InvalidSignature` or `InstallVerificationFailed`). Invalid signing certificates
return `InvalidCertificate` or `RevokedCertificate`. The verifier owns any image
download, and the engine still never flashes hardware. Snapshot restore rejects
invalid firmware signature metadata.
