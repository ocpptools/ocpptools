# 0011. No bundled X.509 reference adapter

- Status: accepted
- Date: 2026-11-09

## Context

ADR 0009 approved opt-in real cryptography and planned a reference adapter in
`@ocpptools/simulator/security`. A prototype using `@peculiar/x509` was built
and audited. The audit found PKIX gaps that are not acceptable for a reference
implementation: optional issuer `basicConstraints`, ignored path length,
incomplete EKU/role checks, and no trust-store semantics for
`InstallCertificate`. Fixing them requires a dedicated PKIX implementation,
negative/vector tests, name constraints, critical-extension handling and an
external security review.

Shipping that prototype as a reference would be worse than shipping no
validator: consumers could trust an incomplete chain validation. The engine
already exposes the injectable `validateCertificateChain` contract from ADR
0009 and can stay crypto-free.

## Decision

1. **Do not bundle a reference X.509/ASN.1/EXI implementation.** The simulator
   exposes only the callback interfaces (`validateCertificateChain`,
   `trustStore`, and future phase-specific hooks).
2. **Remove the prototype subpath and dependencies.** No `@peculiar/x509`,
   ASN.1 or `reflect-metadata` peer is added to the package. Consumers choose
   their own library or service.
3. **Keep the opt-in contract.** `SecurityOptions201` remains, defaults to
   simulated, and the engine never imports a crypto library or stores private
   keys.
4. **Document a reference recipe, not a reference implementation.** The README
   can show the shape of a custom validator and the trust-store expectations;
   it must not imply that a validated implementation ships.
5. **Revisit only with a dedicated security phase.** A future bundled validator
   needs a new ADR, full PKIX scope, test vectors, dependency audit and external
   review.

## Consequences

- Consumers keep full control over certificate parsing, trust stores and
  revocation.
- The package has no crypto dependency and no incomplete validator.
- A future first-party validator is explicitly out of scope until a security
  phase is approved.
- ADR 0009's reference-adapter wording is superseded in part by this decision.
