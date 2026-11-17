# Roadmap

This roadmap shows what the project works on now, next, and later. It is
directional, not a promise of dates. To influence it, open a
[discussion](https://github.com/ocpptools/ocpptools/discussions) and describe
your use case: real consumer needs decide what becomes stable.

Packages are published only after they have tests and package checks, and a
stable release needs a real consumer.

How the project got here, phase by phase, is in
[docs/HISTORY.md](docs/HISTORY.md).

## Where things stand

All packages are published on npm as **alpha** (0.x):

| Package                   | Status                                                                |
| ------------------------- | --------------------------------------------------------------------- |
| `@ocpptools/core`         | Alpha. Frames, parser, serializer, error codes, transport interfaces. |
| `@ocpptools/schema-utils` | Alpha. Draft normalization, `$ref` resolution, field metadata.        |
| `@ocpptools/validator`    | Alpha. Tested against all 184 OCPP 1.6J and 2.0.1 schemas.            |
| `@ocpptools/simulator`    | Alpha. All 28 OCPP 1.6J and 64 OCPP 2.0.1 actions; browser and Node.  |
| `@ocpptools/builder`      | Alpha. Headless payload and frame construction.                       |
| `@ocpptools/testing`      | Alpha. Mock CSMS, in-memory transport, frame factories, fake clock.   |
| `@ocpptools/schemas`      | Alpha. Unmodified OCA JSON Schemas under CC BY-ND 4.0.                |
| `ocpptools` (CLI)         | Alpha. Frame validation and simulator scenarios.                      |

The live versions are in the [README](README.md#which-package-do-i-need) and
the [API inventory](docs/API-INVENTORY.md).

## Now

- **Documentation.** Getting-started guide, task guides, and shorter package
  READMEs that link to reference pages.
- **Releases.** Release the CLI `--no-schema` mode, and write release notes that
  describe the effect of each change.
- **Contributor onboarding.** Keep a set of `good first issue` and
  `help wanted` issues open.

## Next

- **Simpler validator setup.** Today, validating with the official schemas needs
  a schema registry and a loader. Reduce the setup to a few lines without
  bundling every schema into every consumer.
- **Hosted API documentation.** The TypeDoc output is generated in CI but not
  published yet.
- **1.0 policy.** The compatibility rules for 1.0 need real consumer feedback
  and a separate ADR.
- **Launch.** The project launches publicly only after the private website
  consumes the published packages in production and a third party can build a
  basic simulator from the documentation.

## Later

These items need a named consumer, a legal review, or both, before work starts:

- **`@ocpptools/kit`.** A composition package, created only when a named
  external consumer asks for it and the package APIs are stable. The request
  must name the use case, the packages to compose, and why importing them
  directly is insufficient. Until then there is no `packages/kit`.
- **A complete OCPP 2.0.1 device-model catalog** (today curated, see
  [ADR 0008](docs/ADR/0008-device-model-catalog.md)).
- **OCPP 2.1.0** (deferred, see [ADR 0010](docs/ADR/0010-ocpp-2-1-deferral.md)).
- **A bundled X.509, ASN.1, or EXI reference implementation** (out of scope
  under [ADR 0011](docs/ADR/0011-no-reference-crypto-adapter.md); it needs a
  dedicated security phase with external review).

## Non-goals

- No hosted CSMS or hosted service.
- No UI components or UI framework packages; packages stay headless.
- No package per website tool.
- No edited, generated, or adapted copies of the OCPP JSON Schemas.
- No website content, SEO pages, ads, analytics, deployment configuration, or
  private assets in this repository.
- No OCPP conformance or certification claims.

## Release decisions

`@ocpptools/testing` was published as alpha at the owner's request, without a
named external consumer ([ADR 0014](docs/ADR/0014-testing-utilities.md),
[ADR 0015](docs/ADR/0015-testing-publication-override.md)). The two lines below
are read by `pnpm check:testing-gate`; keep them exactly in this form.

testing-release-decision: owner-override
testing-approved: 2026-11-11 owner
