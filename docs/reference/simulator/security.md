# Security integration (OCPP 2.0.1)

Opt-in callbacks that replace the simulated certificate, CSR, revocation,
ISO 15118, and firmware checks of `Simulator201` with real ones that you
provide.

Back to the [simulator reference](README.md) · [package README](../../../packages/simulator/README.md)

The samples use `simulator` for a `Simulator201` instance created as in the
[package README quick start](../../../packages/simulator/README.md#quick-start).
See [docs/security/crypto-15118.md](../../security/crypto-15118.md) for the
threat model and the full callback contract.

## Options

`Simulator201Options.security` is opt-in and has no effect unless it is set. The
default remains simulated. The supported options are
`validateCertificateChain`, `trustStore`, `csrProvider`, `revocation`,
`allowUnknownRevocation`, and `callbackTimeoutMs`.

- `trustStore` and the current clock are passed to the validator.
- `callbackTimeoutMs` bounds every injected security callback and defaults to
  10 seconds.
- `trustStore` and `revocation` require a certificate validator or a firmware
  verifier, and `allowUnknownRevocation` requires a revocation checker; an
  incomplete configuration fails at construction.
- A validator implies `mode: 'real'`; an explicit `simulated` mode with a
  validator is rejected. `real` without a validator also fails with
  `invalid-options`.

## Certificate signing requests

A CSR provider can be used with
`certificates.signWithProvider({ subject, keyRef, certificateType? })`, which
returns `{ keyRef, response }`. Outbound certificate requests reject
private-key material and malformed CSR values.

## Certificate chains and revocation

`revocation` runs after a real `CertificateSigned` chain validates:

- `good` accepts.
- `revoked` rejects.
- `unknown` rejects unless `allowUnknownRevocation` is true.
- Malformed results or errors reject.

A rejected real chain emits `InvalidChargingStationCertificate`. Root
installation through `InstallCertificate` is not revocation-checked. A
`CertificateSigned` request without `certificateType` stores the chain for both
uses.

## ISO 15118

An `iso15118` codec enables
`certificates.get15118Message(schemaVersion, action, payload)`: the simulator
encodes the request, sends `Get15118EVCertificate`, requires an `Accepted`
response with a valid `exiResponse`, decodes it, and optionally runs
`validateResponse`.

The codec receives `{ schemaVersion, action, payload }` in `encodeRequest`,
`{ schemaVersion, action, exiResponse }` in `decodeResponse`, and
`{ schemaVersion, action, response }` in `validateResponse`. Requests and
responses are limited to 5600 characters and reject PEM private-key material.

Without a codec, the raw request/response methods remain available and no EXI
implementation is bundled.

## Firmware verification

A `firmwareVerifier` enables real `UpdateFirmware` checks:

1. The request-level signing certificate is validated and revocation-checked
   when a validator or checker is configured, returning `InvalidCertificate` or
   `RevokedCertificate`.
2. After the simulated download, the verifier receives the firmware metadata,
   signature, and signing certificate, and owns any image download.
3. A valid result emits `SignatureVerified`; an invalid one emits
   `InvalidSignature` or `InstallVerificationFailed`.

The engine still never flashes hardware or fetches the image. In simulated mode
without a verifier, the firmware state machine is unchanged; real mode rejects
`UpdateFirmware` when no verifier is configured.

## Keys, history, and snapshots

The engine does not import a crypto library and its security state never stores
private keys. No X.509, ASN.1, or EXI reference implementation is bundled;
consumers provide their own validator or service.

Snapshots do not contain private keys in security state, but `getHistory()`,
autosave, and snapshots with `includeHistory` can retain raw inbound and
outbound frames before or after validation. Clear or redact history before
saving or exporting sensitive material.
