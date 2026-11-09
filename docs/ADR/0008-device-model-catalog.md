# 0008. Device model catalog scope

- Status: accepted
- Date: 2026-11-09

## Context

ADR 0006 records that the simulator ships no schema-derived action or
device-model catalog. The 2.0.1 profile keeps a curated, hand-written subset of
components, variables, and attributes. A complete standard catalog would be
useful to some CSMS test suites, but it carries legal risk because it would
reproduce structured data from the OCA/IEC specifications, and there is no
external consumer that requires it today.

The OCA JSON Schemas are licensed separately (ADR 0003) and must never be used
to generate a catalog inside this repository.

## Decision

1. **Keep the curated catalog.** The simulator keeps the hand-written subset it
   already uses. It is enough for the supported 2.0.1 actions and tests.
2. **Do not publish a complete standard catalog.** No full component/variable/
   attribute catalog is generated, copied, or derived from the OCA schemas or
   any other specification table.
3. **Revisit only with a consumer and legal review.** A future change needs a
   named consumer, a new ADR that supersedes this one, and a legal review of the
   source and license. Until then the item stays out of the release scope.

## Consequences

- The package does not claim complete device-model coverage.
- `GetVariables`, `SetVariables`, monitoring, and reports stay limited to the
  curated catalog.
- The limitation is documented in the simulator README and the roadmap.
- No new dependency, schema copy, or generated data is added.
