# Contributing

Thank you for your interest in OCPP Tools. The root `package.json` is the
source of truth for commands.

## Prerequisites

- Node.js 22.12 or newer.
- pnpm, using the version pinned in the root `packageManager` field.
- [REUSE](https://reuse.software/) (`pipx install "reuse[charset-normalizer]"`),
  only needed to run the license check locally.

## Setup

```bash
pnpm install
pnpm verify
```

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

`pnpm verify` runs the full chain. To run the steps one by one, use this
order before opening a pull request:

1. `pnpm lint`
2. `pnpm format:check`
3. `pnpm typecheck` and `pnpm typecheck:test`
4. `pnpm test:coverage`
5. `pnpm build`
6. `pnpm lint:packages` (`publint`, `attw`), `pnpm test:pack` (installs the
   packed tarball in a throwaway project), and `pnpm size`
7. `pnpm lint:ai-files` and `pnpm lint:licenses`

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
- Do not commit AI-assistant files (instructions, rules, prompts, memory, or
  local settings, including `AGENTS.md`). They are ignored by Git and
  `pnpm lint:ai-files` fails CI if any is tracked.
- Do not add website content, SEO pages, ads, analytics, deployment
  configuration, private assets, or the private website’s name or URL.
- Public documentation is written in English.

## Security reports

Do not open public issues for vulnerabilities. Use GitHub Private Vulnerability
Reporting for this repository. See [SECURITY.md](SECURITY.md).
