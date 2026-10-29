# Roadmap

This roadmap describes the intended order of work. It is directional, not a
promise of dates. Packages are published only after they have tests, package
checks, and a real consumer.

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
builder depend on it. Keep OCPP schemas out of the public repository until
their license is verified.

## Phase 3 — Validator

Extract `@ocpptools/validator`: Ajv, ajv-formats, injectable schema registry,
lazy compilation per action, and readable errors for 1.6J and 2.0.1. The first
real consumer is the private website, which must use the published package.

## Phase 4 — Simulator

Extract `@ocpptools/simulator` as a headless protocol engine. Split the current
DOM-coupled website code into RPC, connection, state, protocol flows, and
transport adapters. Browser and Node transports live in subpaths. Validate
against a mock CSMS.

## Phase 5 — Builder

Extract `@ocpptools/builder` as a headless schema-driven message constructor.
Remove UI and Tailwind presets from the model. If the split cannot be done
cleanly, the builder stays internal and is not published.

## Phase 6 — Testing utilities

Create `@ocpptools/testing` only if external users ask for it: mock CSMS,
in-memory transport, frame factories, and fixtures. Fixtures must not include
unlicensed OCPP schemas.

## Phase 7 — Kit and CLI

Create `@ocpptools/kit` and the `ocpptools` CLI only after the earlier packages
are stable. `kit` uses explicit exports, not indiscriminate `export *`. The CLI
is published last and must be functional, not a placeholder.

## Phase 8 — Launch

Finish package READMEs, API documentation, examples, changelogs, release
process, and OpenSSF posture. Launch only after the private website consumes
the published packages in production and a third party can build a basic
simulator from the documentation.

## Non-goals

- No hosted CSMS.
- No website content, SEO, ads, analytics, or private assets in this repo.
- No OCPP schemas until their license is verified.
- No package per website tool.
- No UI framework packages.
