# 0009. Real cryptography and ISO 15118 scope

- Status: accepted
- Date: 2026-11-09

## Context

The simulator currently stores simulated certificate records, security events,
firmware, and 15118 requests. It does not parse X.509, validate chains, check
revocation, verify firmware signatures, or exchange real ISO 15118/EXI
messages. ADR 0006 explicitly marks those as simulated records and not
conformance evidence.

The owner approved **Level B**: real cryptography and a real 15118 integration
phase. This is security-sensitive and cannot be a silent replacement of the
simulated behavior. The engine must stay usable without Node-only crypto, must
not persist private keys, and must not make automatic network requests.

## Decision

1. **Opt-in real security.** The default remains simulated. A new
   `@ocpptools/simulator/security` subpath will host real X.509, revocation, and
   15118 adapters. The 2.0.1 options accept injected certificate, CSR,
   revocation, firmware, and 15118 codec interfaces; the engine keeps no
   built-in dependency on a crypto or EXI library.
2. **WebCrypto first.** Hashing, signature verification, and key handling use
   the injected/global WebCrypto surface available in browsers and Node 22.
   Private keys and trust-store secrets never enter security state. Raw
   protocol history is diagnostic and may retain inbound frames before
   validation; snapshots with `includeHistory`, autosave, and `getHistory()`
   can expose them, so callers must clear or redact history before saving or
   exporting sensitive material.
3. **ASN.1/X.509 phase.** Parse PEM/DER chains with a reviewed ASN.1/X.509
   library, validate validity, key usage, EKU, issuer signatures, and trust
   anchors, and compute the OCPP certificate hash data from the DER structures.
   Revocation is an injected OCSP/CRL checker; the engine does not fetch URLs on
   its own.
4. **ISO 15118 phase.** EXI encoding/decoding and Plug & Charge live behind an
   injected codec interface. Shipping a full EXI stack requires a separate
   dependency, license, and interoperability review; the simulator must not
   claim 15118 conformance before that gate.
5. **Firmware and security events.** Firmware signature verification and
   normative security-event payloads use the same injected crypto surface.
   Simulated status transitions remain available for lab work.
6. **Release gate.** No real-security release without a security review,
   dependency audit, negative/vector tests, and updated documentation. The
   public API stays opt-in until that gate passes.

## Consequences

- The existing simulated behavior remains compatible and clearly labeled.
- Real crypto becomes an explicit configuration choice, not a hidden behavior
  change.
- Full ISO 15118/EXI and third-party certification remain out of scope until a
  separate implementation and review land.
- No private key material is added to the repository or security state. Raw diagnostic history can retain inbound frames; callers must clear or redact it before saving or exporting sensitive material.
