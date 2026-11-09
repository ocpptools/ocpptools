# Cryptography and ISO 15118 security model

- Status: implemented as opt-in interfaces; no bundled crypto or EXI implementation.
- Applies to: `@ocpptools/simulator` 0.4.0 and the OCPP 2.0.1 profile.
- Related decisions: ADR 0009, ADR 0011, ADR 0012.

## Scope

The simulator exposes callbacks for certificate validation, revocation checks,
CSR generation, firmware verification, and ISO 15118/EXI encoding. The default
behavior remains simulated. No private keys, trust anchors, OCSP/CRL data, or
EXI implementation are bundled.

This model does not claim OCPP or ISO 15118 conformance, certification, or
production key management. A consumer that enables a callback is responsible
for its implementation, dependencies, key storage, and network policy.

## Assets

- Certificate chains, root and intermediate certificates, and trust anchors.
- Certificate hashes and metadata returned to the CSMS.
- CSR output and the opaque key reference returned by the CSR provider.
- Revocation results and the policy for unknown results.
- Firmware metadata, signatures, signing certificates, and the firmware image.
- ISO 15118 EXI requests and responses.
- Security event records and their technical information.
- Diagnostic protocol history and snapshots.

## Adversaries and threats

| Threat                                                 | Mitigation                                                                                                                                                                                   |
| ------------------------------------------------------ | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Malicious CSMS sends invalid or unrelated certificates | The injected validator must verify chain, purpose, dates, usage, and trust anchor. The simulator rejects anything the callback rejects.                                                      |
| Revoked certificate accepted                           | Optional revocation callback; `revoked` and malformed results fail closed; `unknown` fails unless explicitly allowed.                                                                        |
| Private key crosses the engine boundary                | Inbound certificate, signed-chain, CSR, and security-event text is scanned for PEM private keys. Outbound CSR and EXI strings are checked before sending. The engine stores no key material. |
| Malformed CSR or oversized payload                     | CSR must be one PEM certificate request of at most 5500 characters. EXI requests and responses are limited to 5600 characters.                                                               |
| ISO 15118 response with a failure status               | Non-`Accepted` responses are rejected; the EXI payload is decoded only after a successful status.                                                                                            |
| Firmware image or signature substituted                | Request-time signing-certificate validation, optional revocation, and a post-download verifier. Failures emit `InvalidSignature` or `InstallVerificationFailed`.                             |
| Replay or replacement during an update                 | Duplicate request IDs are rejected; a generation token invalidates superseded flows; timers and verification results check the generation.                                                   |
| Snapshot poisoning                                     | Security and firmware fields are type-checked and scanned for private-key material on restore. Unfinished firmware updates normalize to `Idle`.                                              |
| Log injection through callback text                    | Security event text is scanned for private keys; 15118 failure reasons are restricted to a short safe character set.                                                                         |
| Slow or hanging callback                               | `callbackTimeoutMs` bounds every injected security callback (default 10 seconds) using the simulator scheduler.                                                                              |

## Trust boundaries

- **Engine:** pure TypeScript, no crypto dependency, no DOM, no Node built-ins,
  no network, and no private-key storage.
- **Callbacks:** consumer code. They may use WebCrypto, a library, or a remote
  service. The engine treats their results as untrusted input and validates the
  shape and policy.
- **Transport:** the browser and Node adapters own TLS. The simulator does not
  validate the CSMS server certificate.
- **Persistence:** the consumer owns storage. Trust stores, callbacks, and key
  references are options, not snapshot state.
- **History:** raw inbound and outbound frames are diagnostic. They can contain
  material rejected before validation. Clear or redact history before export.

## Callback model

`SecurityOptions201.mode` controls certificate validation only:

- Omitted: `real` when `validateCertificateChain` is present, otherwise
  `simulated`.
- `real`: requires `validateCertificateChain`.
- `simulated`: rejects a configured validator.

The other callbacks are independent and active when provided:

| Option                     | Behavior                                                                                                             |
| -------------------------- | -------------------------------------------------------------------------------------------------------------------- |
| `trustStore`               | Passed to the validator and firmware verifier. Requires a validator or firmware verifier.                            |
| `validateCertificateChain` | Validates `InstallCertificate` and `CertificateSigned` chains with the injected clock and trust store.               |
| `revocation`               | Checks `CertificateSigned` leaf chains and firmware signing certificates. Requires a validator or firmware verifier. |
| `allowUnknownRevocation`   | Accepts `unknown` results; `revoked` and malformed results still fail. Requires `revocation`.                        |
| `csrProvider`              | Generates a CSR through `certificates.signWithProvider`.                                                             |
| `iso15118`                 | Encodes, sends, decodes, and optionally validates 15118 messages.                                                    |
| `firmwareVerifier`         | Verifies the downloaded firmware image. Owns any image fetch.                                                        |
| `callbackTimeoutMs`        | Positive timeout for every callback.                                                                                 |

## OCPP action behavior

| Action                       | Real behavior                                                                                                                                                                                              |
| ---------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `InstallCertificate`         | Validates the root certificate with the injected validator. Revocation is not checked for roots. Stores only a validated hash and public certificate.                                                      |
| `CertificateSigned`          | Validates the ordered chain and optionally revocation. `good` accepts; `revoked`, `unknown` unless allowed, and malformed results reject. A rejected real chain emits `InvalidChargingStationCertificate`. |
| `DeleteCertificate`          | Exact hash match against stored certificates.                                                                                                                                                              |
| `GetInstalledCertificateIds` | Returns stored hashes and certificate types.                                                                                                                                                               |
| `SignCertificate`            | Sends one validated PEM CSR. `signWithProvider` creates it through the provider and returns the provider key reference.                                                                                    |
| `UpdateFirmware`             | Validates metadata and signing certificate, optionally checks revocation, then accepts. The verifier runs after the simulated download.                                                                    |
| `Get15118EVCertificate`      | Encodes through the codec, requires `Accepted`, validates and decodes the EXI response, then optionally runs the response validator.                                                                       |
| `SecurityEventNotification`  | Stores and sends events with private-key text rejected.                                                                                                                                                    |

## Error policy

- Invalid input, private-key material, and malformed CSRs or EXI strings are
  rejected before they reach state or the wire.
- Callback failures are fail-closed for the action that depends on them.
- Error messages do not include certificate bodies, CSR bodies, EXI payloads,
  private keys, or key references.
- Security event text is scanned for PEM private keys.

## Network policy

The engine performs no network requests. Validators, revocation checkers, the
firmware verifier, and the EXI codec are consumer callbacks. A callback may use
the network, but that is outside the simulator's trust boundary and must follow
the consumer's policy.

## Persistence

- Snapshots store public certificates, hash metadata, signed chains, security
  events, and firmware signature metadata.
- Trust stores, callbacks, and CSR key references are not persisted.
- Restore validates every security string field and rejects PEM private-key
  material.
- Unfinished firmware updates are canceled and normalized to `Idle` on restore.
- Revocation responses are not cached or persisted; there is no revocation
  cache in this release.

## Limits

- No bundled X.509, ASN.1, EXI, OCSP, or CRL parser.
- No automatic OCSP/CRL fetch and no `GetCertificateStatus` response parser.
- No private-key generation, storage, or persistence.
- No firmware flashing and no automatic image download.
- No claim of OCPP or ISO 15118 conformance.
- PEM private-key detection is a guardrail, not a general secret scanner.

## Verification

- Unit tests cover policy, rejection, timeouts, snapshot poisoning, and status
  transitions.
- The simulator bundle check keeps the engine free of DOM, Node built-ins,
  ambient time, and ambient randomness.
- `pnpm verify` runs lint, formatting, typecheck, tests, build, bundle checks,
  package smoke tests, size limits, and REUSE.
