# 0012. Security callback model

- Status: accepted
- Date: 2026-11-09

## Context

ADR 0009 approved opt-in real cryptography and ISO 15118 support. ADR 0011
removed the bundled X.509 reference adapter because an incomplete PKIX
implementation is worse than none. The simulator now exposes independent
callbacks for certificate validation, revocation, CSR generation, firmware
verification, and ISO 15118/EXI. That model needs a decision record: it defines
which option controls what, when a failure is final, and what is persisted.

## Decision

1. **Certificate mode is certificate-only.** `SecurityOptions201.mode` controls
   `validateCertificateChain`. Other callbacks are independent and active when
   provided. A simulated mode rejects a configured validator; a real mode
   requires one.
2. **Every callback is optional.** A consumer may use a custom implementation, a
   third-party library, or none. The engine imports no crypto or EXI library.
3. **Revocation is scoped.** The checker runs on `CertificateSigned` leaf chains
   and on firmware signing certificates. It does not run on root installation.
   `good` accepts; `revoked`, `unknown`, malformed results, errors, and timeouts
   reject. `unknown` is accepted only with `allowUnknownRevocation`.
4. **CSR generation never exposes keys.** `csrProvider` returns a PEM CSR and a
   key reference. The simulator sends only the CSR (validated, one PEM block, at
   most 5500 characters) and never stores the key reference.
5. **Firmware verification is split by OCPP phase.** Request-time metadata and
   signing-certificate checks return `InvalidCertificate` or
   `RevokedCertificate`. The post-download verifier returns a result that maps
   to `SignatureVerified`, `InvalidSignature`, or `InstallVerificationFailed`.
   The verifier owns any image download; the engine does not fetch it.
6. **ISO 15118 is an injected codec.** The codec receives typed input objects,
   the engine enforces the 5600-character EXI bound and the OCPP status, and no
   EXI implementation is bundled.
7. **Fail closed and bound every callback.** All callbacks use
   `callbackTimeoutMs` (default 10 seconds). Unfinished firmware flows are
   invalidated by a generation token and normalized on restore.
8. **No secrets in state or snapshots.** The engine never stores private keys,
   trust stores, callbacks, or key references. Snapshot restore validates every
   security string field and rejects PEM private-key material.

## Consequences

- Consumers control crypto, trust, network policy, and key storage.
- The engine stays small, browser/Node portable, and free of crypto
  dependencies.
- A future bundled validator needs a new ADR, full PKIX scope, test vectors,
  dependency audit, and external review.
- The model is documented in `docs/security/crypto-15118.md` and the simulator
  README.
