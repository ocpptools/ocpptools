# Security Policy

## Supported versions

All packages are in the 0.x series. Only the latest published minor version of
each package receives security fixes.

| Package                              | Supported                   |
| ------------------------------------ | --------------------------- |
| `@ocpptools/*` and `ocpptools` (CLI) | Latest minor version on npm |
| Older minor versions                 | No                          |

## Reporting a vulnerability

Use
[GitHub Private Vulnerability Reporting](https://github.com/ocpptools/ocpptools/security/advisories/new)
for this repository. Do not open a public issue, discussion, or pull request for
a suspected vulnerability.

Please include:

- The affected package and version.
- The OCPP protocol version and message type, if relevant.
- A minimal reproduction, with secrets and personal data removed.
- The impact and any known workaround.

## What to expect

- Reports are acknowledged within seven days, on a best-effort basis.
- The maintainers confirm the issue, agree on a fix and a disclosure date with
  the reporter, and credit the reporter in the advisory unless they prefer
  otherwise.
- There is no bug bounty.

## Scope

In scope:

- Published packages under the `@ocpptools` npm scope.
- The `ocpptools` CLI.
- The release workflow and supply chain of this repository.

Out of scope:

- Private website content or infrastructure.
- OCPP JSON Schemas that are not distributed by this repository.
- Third-party services, registries, or dependencies beyond their own advisories.
- Social engineering, physical attacks, or denial of service against users.

## Safe reports

Do not include CSMS credentials, private keys, certificates, idTag values,
unique message IDs tied to production systems, personal data, or full logs with
sensitive values. Redact them before submitting.

## Fixes

Security fixes are released through CI with npm provenance. A GitHub Security
Advisory and the release notes describe the severity, affected versions, and
upgrade path.

The project's security controls are described in
[docs/SECURITY-BASELINE.md](docs/SECURITY-BASELINE.md). The threat model for the
simulator's cryptography callbacks is in
[docs/security/crypto-15118.md](docs/security/crypto-15118.md).
