# OCPP Tools

Open-source TypeScript libraries for the Open Charge Point Protocol (OCPP):
frame parsing, schema-driven validation, headless charging-station simulation,
and message construction for OCPP 1.6J and 2.0.1.

> **Status:** alpha. `@ocpptools/core` 0.1.0 is published on npm; the other
> packages are planned. APIs are unstable until 1.0.0.

## What this repository is

- A monorepo for small, testable OCPP packages.
- Protocol libraries and developer tooling.
- A public, Apache-2.0-licensed codebase.

## What this repository is not

- Not a hosted CSMS.
- Not a website, SEO project, or content repository.
- Not a place for ads, analytics, deployment configuration, or private assets.
- Not the author of the OCPP JSON Schemas. They are written by the Open Charge
  Alliance. Unmodified copies live in `@ocpptools/schemas`, under CC BY-ND 4.0.

## Packages

| Package                   | Status         | Purpose                                                            |
| ------------------------- | -------------- | ------------------------------------------------------------------ |
| `@ocpptools/core`         | Alpha          | OCPP types, frames, parser/serializer, transport interfaces        |
| `@ocpptools/schema-utils` | In development | JSON Schema normalization and field metadata                       |
| `@ocpptools/validator`    | Planned        | Ajv-based validation with an injectable schema registry            |
| `@ocpptools/simulator`    | Planned        | Headless charging-station simulator with injectable transports     |
| `@ocpptools/builder`      | Planned        | Headless payload and frame construction                            |
| `@ocpptools/schemas`      | Unreleased     | Unmodified OCA JSON Schemas (CC BY-ND 4.0, © Open Charge Alliance) |

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
- The OCPP schemas are the Open Charge Alliance's. Only unmodified copies of
  the originals are kept, in one package, with their license and attribution.

## Roadmap

See [ROADMAP.md](ROADMAP.md).

## Contributing

See [CONTRIBUTING.md](CONTRIBUTING.md). Contributions are accepted under the
Developer Certificate of Origin (DCO). Public API changes require a changeset.

## Security

See [SECURITY.md](SECURITY.md). Report vulnerabilities privately through GitHub
Private Vulnerability Reporting for this repository.

## License

Apache License, Version 2.0, for the code and documentation. See
[LICENSE](LICENSE) and [NOTICE](NOTICE). The Open Charge Alliance's JSON Schemas
are the exception, see below.

## Third-party material

The OCPP JSON Schemas in [`packages/schemas`](packages/schemas) are not our
work. They are written and published by the
[Open Charge Alliance](https://openchargealliance.org/), which holds the
copyright. They are included as byte-for-byte copies of the originals under the
Creative Commons Attribution-NoDerivatives 4.0 International license
(CC BY-ND 4.0). The Apache License does not apply to them. See
[packages/schemas/SOURCES.md](packages/schemas/SOURCES.md) and
[LICENSES/CC-BY-ND-4.0.txt](LICENSES/CC-BY-ND-4.0.txt).

## Trademark notice

OCPP is a trademark of the Open Charge Alliance (OCA). OCPP Tools is an
independent open-source project and is not affiliated with, endorsed by,
sponsored by, or certified by the Open Charge Alliance. See
[TRADEMARKS.md](TRADEMARKS.md).
