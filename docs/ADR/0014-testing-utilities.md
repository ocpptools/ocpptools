# 0014. Testing utilities: unpublished readiness and publication gate

- Status: accepted; the publication gate in point 9 is superseded by [0015](0015-testing-publication-override.md)
- Date: 2026-11-09

## Context

Phase 6 of the roadmap covers a possible `@ocpptools/testing` package with a
mock CSMS, an in-memory transport, frame factories, and fixtures. The roadmap
originally allowed creating the package only after external users asked for it.
As of 2026-11-09 there is no named external consumer.

The maintainer authorized an unpublished implementation as readiness work. This
is a deliberate exception to the original creation gate. It does not satisfy or
relax the publication gate: the package is not published to npm, is not
supported, and carries no compatibility promise.

`private: true` in a public repository means npm-unpublished, not confidential.
The source is public under Apache-2.0.

## Decision

1. **Unpublished readiness.** `@ocpptools/testing` is maintained at
   `0.0.0` with `private: true`. It is not published to npm until the
   publication gate in point 9 is met. It has no changeset and no
   `CHANGELOG.md` while it is unpublished; Changesets ignores private packages.

2. **Scope.** The package provides a protocol-level mock CSMS, an in-memory
   transport that implements `Transport`, frame factories, synthetic fixtures,
   and a deterministic fake clock. It is a test utility, not a complete CSMS,
   a charge point, or a conformance tool.

3. **Transport-agnostic mock.** The mock CSMS receives a `Transport` from the
   caller. The root entry does not open sockets, negotiate WebSocket
   subprotocols, use TLS, or depend on `ws`. A future Node adapter needs a new
   decision and is not part of 0.1.0.

4. **Core-only runtime.** The only runtime dependency is `@ocpptools/core`.
   `@ocpptools/simulator`, `@ocpptools/validator`, and `@ocpptools/schemas`
   are devDependencies for integration tests. The package does not import
   Ajv, DOM, Node built-ins, Tailwind, or the private website.

5. **No OCA data.** The package ships no OCA schema, schema copy, schema
   adaptation, action list, per-action type, field catalogue, default OCPP
   response, or response catalogue. The mock accepts arbitrary action strings
   and has no built-in handlers. Error codes come from `@ocpptools/core`; the
   1.6J and 2.0.1 sets are never merged.

6. **Synthetic public fixtures.** The README and public fixtures use the
   synthetic action `Example` and generic JSON payloads. Unit tests use
   synthetic actions.

7. **Test-only real actions.** Integration tests may hand-write real action
   names and minimal payloads. They are not committed as fixtures, not copied
   to the public README, not shipped in the tarball, and not generated from the
   OCA schemas. Loading `@ocpptools/schemas` at runtime in those tests is
   allowed as data, following ADR 0003.

8. **Versioning.** The package is versioned independently and is not added to
   the Changesets `fixed` group. The fixed group remains `core`, `schema-utils`,
   and `validator`. The first publication is `0.1.0`, not `0.0.0`. There are no
   version subpaths in 0.1.0; a future Node or browser adapter requires a new
   decision. If the package cannot stay within the size or legal boundary, it
   stays unpublished.

9. **Publication gate.** Publication requires all of the following:

   - A named external consumer, not the owner, the private website, the CLI,
     the simulator, the validator, or the builder.
   - A concrete use case and expected outcome.
   - An explanation of why the existing packages or a small local helper are
     insufficient.
   - Acceptance of the alpha API and a commitment to give feedback.
   - Maintainer approval recorded in `ROADMAP.md`.
   - A release PR that removes `private`, sets `0.1.0`, adds the changelog, and
     updates the public status.

   If no consumer appears, the package may be removed before publication with
   no deprecation obligation. If the split cannot stay clean, it stays
   unpublished.

10. **Release process.** Publication goes only through CI with provenance; no
    local `npm publish`. The package is Apache-2.0 only. It does not include
    `LICENSE-CC-BY-ND-4.0.txt` because it ships no OCA schemas. The README
    carries the OCA non-affiliation notice.

## Consequences

- The repository gains an unpublished, unsupported package for readiness work.
- The fixed group and the published packages are unchanged.
- Consumers cannot install the package from npm until the gate is met.
- The simulator, CLI, and website keep their existing test helpers; migrating
  them to the unpublished package is optional and not required.
- A future WebSocket adapter, OCA response catalogue, or schema-derived helper
  needs a new ADR and legal review.
