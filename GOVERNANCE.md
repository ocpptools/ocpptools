# Governance

## Model

OCPP Tools currently uses a BDFL model. The project owner makes final decisions
while the maintainer team is small. The goal is to move toward shared
maintainership as trusted contributors emerge.

## Roles

- **Contributor:** opens issues, discussions, and pull requests.
- **Triager:** labels issues, reproduces bugs, and manages discussions.
- **Maintainer:** reviews and merges pull requests, manages releases, and owns
  one or more packages.
- **Project owner:** final decision-maker, release authority, and steward of
  the project’s legal and security posture.

## Decision process

- Small changes are decided in pull requests.
- Cross-package or architectural changes are decided through an Architecture
  Decision Record (ADR) in `docs/ADR/`.
- Disagreements are resolved by lazy consensus: if a proposal receives no
  substantive objection within seven days, it may proceed.
- If consensus fails, the project owner decides and records the rationale.

## Contribution rules

- Contributions use the Developer Certificate of Origin. No CLA.
- Public API changes require a changeset.
- Security issues are handled privately before public disclosure.
- The only OCPP schemas in the repository are the Open Charge Alliance's
  originals in `packages/schemas`, unmodified and under CC BY-ND 4.0 (see
  [ADR 0003](docs/ADR/0003-oca-json-schemas.md)). The project does not accept
  edited, generated, or other copies of them.

## Releases

Release mechanics and branch rules are defined in
[docs/BRANCHING.md](docs/BRANCHING.md). Releases are cut from `main` through CI
with Changesets, OIDC, and provenance. Maintainers do not publish from local
machines. The project owner may override a release decision only to address
legal, security, or registry problems.

## Maintainership

New maintainers are added by lazy consensus after sustained, high-quality
contributions. Maintainers who become inactive may be moved to emeritus status.
The project owner should document a second administrator and recovery path for
GitHub and npm access.

## Conflicts

Conflicts are handled first through discussion. If discussion fails, the
project owner decides. Conduct violations are handled under
[CODE_OF_CONDUCT.md](CODE_OF_CONDUCT.md).
