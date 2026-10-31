# OCPP Tools

Open-source TypeScript libraries for the Open Charge Point Protocol (OCPP):
frame parsing, schema-driven validation, headless charging-station simulation,
and message construction for OCPP 1.6J and 2.0.1.

> **Status:** pre-alpha. The repository foundation is in place and
> `@ocpptools/core` is feature-complete for its first release but not published
> yet. APIs are unstable until 1.0.0.

## What this repository is

- A monorepo for small, testable OCPP packages.
- Protocol libraries and developer tooling.
- A public, Apache-2.0-licensed codebase.

## What this repository is not

- Not a hosted CSMS.
- Not a website, SEO project, or content repository.
- Not a place for ads, analytics, deployment configuration, or private assets.
- Not a distributor of OCPP JSON Schemas until their license is confirmed.

## Packages

| Package                   | Status     | Purpose                                                        |
| ------------------------- | ---------- | -------------------------------------------------------------- |
| `@ocpptools/core`         | Unreleased | OCPP types, frames, parser/serializer, transport interfaces    |
| `@ocpptools/schema-utils` | Planned    | JSON Schema normalization and field metadata                   |
| `@ocpptools/validator`    | Planned    | Ajv-based validation with an injectable schema registry        |
| `@ocpptools/simulator`    | Planned    | Headless charging-station simulator with injectable transports |
| `@ocpptools/builder`      | Planned    | Headless payload and frame construction                        |
| `@ocpptools/schemas`      | Blocked    | OCPP schemas; pending license review                           |

The build order is `core` → `schema-utils` / schemas decision → `validator` →
`simulator` → `builder`. Optional packages such as `@ocpptools/testing`,
`@ocpptools/kit`, and the `ocpptools` CLI come later.

## Development

Requires Node.js 22.12+ and the pnpm version pinned in `package.json`.

```bash
pnpm install
pnpm verify
```

See [CONTRIBUTING.md](CONTRIBUTING.md) for the individual steps.

## Principles

- One package per capability, not per website tool.
- No DOM, UI framework, or Tailwind in published packages.
- Public packages must be consumed by a real consumer before release.
- Apache-2.0 for code and documentation. DCO, no CLA.
- OCPP schemas stay out of this repository until their license is verified.

## Roadmap

See [ROADMAP.md](ROADMAP.md).

## Contributing

See [CONTRIBUTING.md](CONTRIBUTING.md). Contributions are accepted under the
Developer Certificate of Origin (DCO). Public API changes require a changeset.

## Security

See [SECURITY.md](SECURITY.md). Report vulnerabilities privately through GitHub
Private Vulnerability Reporting for this repository.

## License

Apache License, Version 2.0. See [LICENSE](LICENSE) and [NOTICE](NOTICE).

## Trademark notice

OCPP is a trademark of the Open Charge Alliance (OCA). OCPP Tools is an
independent open-source project and is not affiliated with, endorsed by,
sponsored by, or certified by the Open Charge Alliance. See
[TRADEMARKS.md](TRADEMARKS.md).
