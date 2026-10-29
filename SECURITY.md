# Security Policy

## Supported versions

This project is in the 0.x foundation phase. Only the latest published minor
version receives security fixes. Until a package has its first public release,
no security support is promised.

## Reporting a vulnerability

Use GitHub Private Vulnerability Reporting for this repository. Do not open a
public issue, discussion, or pull request for a suspected vulnerability.

Please include:

- The affected package and version.
- The OCPP protocol version and message type, if relevant.
- A minimal reproduction, with secrets and personal data removed.
- The impact and any known workaround.

Reports are acknowledged within seven days on a best-effort basis. There is no
bug bounty at this time.

## Scope

In scope:

- Published packages under the `@ocpptools` npm scope.
- The `ocpptools` CLI, when published.

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

Security fixes are released through CI with provenance. A GitHub Security
Advisory and release notes describe the severity, affected versions, and
upgrade path.
