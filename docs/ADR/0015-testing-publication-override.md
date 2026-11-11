# 0015. Testing publication without an external consumer

- Status: accepted
- Date: 2026-11-11

## Context

ADR 0014 gated publication of `@ocpptools/testing` on a named external
consumer. As of 2026-11-11 there is still no external consumer. The owner
instructed publishing the package anyway, as an alpha readiness package.

This is an explicit owner override. It is not evidence of external demand.

## Decision

1. Publish `@ocpptools/testing` as an alpha package without a named external
   consumer. The first public version is `0.1.0`; a `0.1.1` patch validates the
   trusted publisher through OIDC.
2. This supersedes only the publication gate in ADR 0014 point 9. The rest of
   ADR 0014 remains in force: scope, transport-agnostic mock CSMS, core-only
   runtime dependency, no OCA schemas or default responses, synthetic public
   fixtures, test-only real actions, independent versioning, and no release
   subpaths.
3. The release decision is recorded in `ROADMAP.md` as
   `testing-release-decision: owner-override` and
   `testing-approved: 2026-11-11 owner`. The release guard accepts only a
   private package, an owner override, or a future consumer URL plus approval.
4. The package remains alpha. It has no stability or compatibility promise
   before 1.0.0. A future 1.0 release still needs real consumer feedback and a
   new decision.
5. Publication goes through CI with provenance. The first publish uses a
   short-lived token because the package does not exist in npm; the trusted
   publisher is configured immediately after, and `0.1.1` validates OIDC.
6. If the package is not adopted, it may be deprecated or retired before 1.0
   with no deprecation obligation for the alpha line.

## Consequences

- The repository publishes an alpha test utility without proven demand.
- The Phase 6 gate changes from "no publication without a consumer" to "the
  owner may publish an alpha; 1.0 still requires consumer feedback".
- The release guard and `docs/RELEASING.md` record the exception.
- The package remains small, unsupported beyond alpha, and free of OCA data.
