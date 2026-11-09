# 0010. OCPP 2.1.0 deferral

- Status: accepted
- Date: 2026-11-09

## Context

ADR 0003 scopes the OCA schema decision to OCPP 1.6J and 2.0.1 and explicitly
excludes OCPP 2.1/IEC 63584-210. OCPP 2.1 introduces new actions, payloads, and
licensing terms that need a separate legal review. The project has no approved
2.1 scope, schemas, or consumer.

## Decision

1. **Do not add OCPP 2.1.0 in the 0.x line.** The supported protocol versions
   remain 1.6J and 2.0.1.
2. **Reject unsupported versions explicitly.** Parsers, the validator, and the
   simulator continue to reject versions outside the supported union with a
   clear error.
3. **Revisit with a separate decision.** Adding 2.1 requires a new ADR, a
   license/terms review for the IEC/OCA material, schema verification, and a
   compatibility plan. It is not implied by the existing 2.0.1 support.

## Consequences

- No 2.1 schemas, profiles, or generated artifacts enter the repository.
- Documentation and the roadmap list 2.1 as deferred, not planned for the next
  release.
- Users who need 2.1 must wait for an explicit, reviewed implementation.
