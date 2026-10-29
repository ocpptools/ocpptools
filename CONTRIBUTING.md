# Contributing

Thank you for your interest in OCPP Tools. This repository is still in the
foundation phase. Until the root package manifest exists, there are no build or
test scripts. Once the workspace is scaffolded, the root `package.json` is the
source of truth for commands.

## Prerequisites

- Node.js 22.12 or newer.
- pnpm, using the version pinned in the root `packageManager` field.

## Workflow

The canonical branching, merge, and release policy is
[docs/BRANCHING.md](docs/BRANCHING.md). The summary below is intentionally
short.

1. Fork the repository and create a branch from `main`.
2. Make the smallest change that solves the problem.
3. Add or update tests for every behavior change.
4. Add a changeset when a public package API changes.
5. Sign your commits with the Developer Certificate of Origin:

   ```bash
   git commit -s -m "feat(core): parse OCPP 2.0.1 call error details"
   ```

6. Open a pull request. Maintainers squash-merge approved changes.

## Verification order

When the scripts exist, run them in this order before opening a pull request:

1. Lint.
2. Format check.
3. Typecheck.
4. Tests.
5. Build.
6. Package checks (`publint`, `attw`).

## Package boundaries

- `core`: types, frames, parser/serializer, and transport interfaces. No Ajv,
  DOM, or complete schemas.
- `schema-utils`: pure JSON Schema normalization. If it remains a runtime
  dependency of published packages, it must be publishable or bundled.
- `validator`: Ajv with an injectable schema registry. No DOM. Lazy compilation
  per action.
- `simulator`: headless protocol engine. Browser and Node transports live in
  subpaths. No DOM, toasts, panels, or Tailwind.
- `builder`: headless payload and frame construction. No UI or Tailwind.
- `schemas`: do not add OCPP schemas until their license is verified.

Keep exported API boundaries on `unknown`, not `any`.

## Tests

- Use Vitest.
- Add tests with every extraction or behavior change.
- Do not copy untested code from another repository into a package.
- Coverage starts at 80% and should ratchet upward.

## Licensing and legal

- Code and documentation are Apache-2.0.
- Contributions are inbound = outbound under Apache-2.0 with DCO sign-off.
- Do not add OCPP JSON Schemas unless their license permits redistribution.
- Do not add website content, SEO pages, ads, analytics, deployment
  configuration, private assets, or the private website’s name or URL.
- Public documentation is written in English.

## Security reports

Do not open public issues for vulnerabilities. Use GitHub Private Vulnerability
Reporting for this repository. See [SECURITY.md](SECURITY.md).
