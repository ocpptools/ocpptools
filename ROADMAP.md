# Roadmap

This roadmap describes the intended order of work. It is directional, not a
promise of dates. Packages are published only after they have tests and package
checks, and a stable release needs a real consumer.

## Phase 0 — Foundation

Set up the public monorepo: legal files, governance, security, tooling, CI,
Changesets, npm publishing, and the first `packages/core` skeleton. The phase
is complete when a fresh clone installs and validates in under ten minutes and
`npm publish --dry-run` shows only the intended files.

## Phase 1 — Core

Extract `@ocpptools/core`: OCPP 1.6J/2.0.1 types, frames, parser/serializer,
message IDs, error codes, and transport/clock/storage interfaces. No Ajv, DOM,
or complete schemas. Freeze a small public API and cover it with tests.

## Phase 2 — Schema utilities and OCA decision

Extract `@ocpptools/schema-utils` for JSON Schema normalization and field
metadata. Decide whether it is published or bundled before validator and
builder depend on it. The OCPP schemas are the Open Charge Alliance's: only
unmodified copies are kept, in `@ocpptools/schemas`, with their license.

Status: `schema-utils` is implemented and tested. It is published with the
validator in 0.2.0, which is its first consumer. `@ocpptools/schemas` holds byte-for-byte copies of the Open Charge
Alliance's JSON Schemas under CC BY-ND 4.0, with attribution. It is published
as an alpha package. The Open Charge Alliance has not confirmed in writing that
the JSON files are covered by the license, and the maintainers accept that risk
(ADR 0003).

## Phase 3 — Validator

Extract `@ocpptools/validator`: Ajv, ajv-formats, injectable schema registry,
lazy compilation per action, and readable errors for 1.6J and 2.0.1. The first
real consumer is the private website, which must use the published package.

Status: implemented and tested against all 184 schemas, with a bundle check and
parity against the live site validators. It is published with `core` and
`schema-utils` in 0.2.0; the site integration follows.

## Phase 4 — Simulator

Extract `@ocpptools/simulator` as a headless protocol engine. Split the current
DOM-coupled website code into RPC, connection, state, protocol flows, and
transport adapters. Browser and Node transports live in separate subpaths. The
Node adapter is delivered at the start of Phase 7; the CLI follows. Validate
against a mock CSMS.

Status: implemented for all 28 OCPP 1.6J actions and all 64 OCPP 2.0.1 actions,
with the browser adapter, schema-valid action matrices, fault injection,
outbound validation, metrics, scenarios, snapshots, completed 1.6 semantics,
and hardened 2.0.1 features. 0.2.0 is published. The Node adapter and the
`ocpptools` CLI are the first pieces of Phase 7, and the site UI migration
remains.

## Phase 5 — Builder

Extract `@ocpptools/builder` as a headless schema-driven message constructor.
Remove UI and Tailwind presets from the model. If the split cannot be done
cleanly, the builder stays internal and is not published.

## Phase 6 — Testing utilities

Create `@ocpptools/testing` only if external users ask for it: mock CSMS,
in-memory transport, frame factories, and fixtures. Fixtures must not include
copies or adaptations of the OCPP schemas.

## Phase 7 — Node adapter, kit, and CLI

Start with the Node adapter in `@ocpptools/simulator/node`, then the
`ocpptools` CLI, which consumes it. Create `@ocpptools/kit` only after the
earlier packages are stable and real consumers ask for it. `kit` uses explicit
exports, not indiscriminate `export *`. The CLI must stay functional, not a
placeholder.

Status: the Node adapter and the `ocpptools` CLI are implemented and tested.
The CLI validates frames with `@ocpptools/validator` and runs simulator
scenarios against a CSMS. Its first npm publish is pending permission for the
unscoped `ocpptools` name; the package stays in the workspace until that is
resolved. `@ocpptools/kit` remains.

## Phase 8 — Real cryptography and ISO 15118

ADR 0009 is implemented as opt-in callbacks: injected X.509 chain validation,
revocation, CSR generation, firmware verification, and an injected ISO 15118/EXI
codec. The default simulator behavior stays simulated. No private keys or
automatic network fetches enter the engine.

A bundled X.509/ASN.1/EXI reference implementation remains out of scope under
ADR 0011. It needs a dedicated security phase with full PKIX scope, test
vectors, dependency audit, and external review. The callback contract and threat
model are documented in `docs/security/crypto-15118.md` and ADR 0012.

The device-model catalog remains curated and hand-written (ADR 0008). A complete
catalog needs a named consumer and a new legal review. OCPP 2.1.0 remains
deferred (ADR 0010) and is not part of this phase.

## Phase 9 — Launch

Finish package READMEs, API documentation, examples, changelogs, release
process, and OpenSSF posture. Launch only after the private website consumes
the published packages in production and a third party can build a basic
simulator from the documentation.

## Non-goals

- No hosted CSMS.
- No website content, SEO, ads, analytics, or private assets in this repo.
- No edited, generated, or adapted copies of the OCPP schemas.
- No package per website tool.
- No UI framework packages.
