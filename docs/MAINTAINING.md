# Maintaining OCPP Tools

This page is the entry point for maintainers. Contributors do not need it; see
[CONTRIBUTING.md](../CONTRIBUTING.md) instead.

## Runbooks

| Document                                      | Covers                                                                 |
| --------------------------------------------- | ---------------------------------------------------------------------- |
| [BRANCHING.md](BRANCHING.md)                  | Branches, pull requests, merge policy, required checks, hotfixes, tags |
| [RELEASING.md](RELEASING.md)                  | Trusted publishing, first publishes, release flow, recovery, incidents |
| [SECURITY-BASELINE.md](SECURITY-BASELINE.md)  | Security controls, OpenSSF Scorecard reading, owner actions            |
| [API-INVENTORY.md](API-INVENTORY.md)          | Public entrypoints, compatibility rules, pre-launch checks             |
| [OCA-CONTINGENCY.md](OCA-CONTINGENCY.md)      | What to do if the OCA schema copies must be withdrawn                  |
| [BUILDER-COVERAGE.md](BUILDER-COVERAGE.md)    | Test coverage record of `@ocpptools/builder`                           |
| [STYLE.md](STYLE.md)                          | Documentation conventions and the package README template              |
| [Demo recordings](../scripts/demos/README.md) | How to re-record the terminal and browser demos in `docs/assets/`      |

Roles, decision making, and the addition of maintainers are in
[GOVERNANCE.md](../GOVERNANCE.md) and [MAINTAINERS.md](../MAINTAINERS.md).

## Triage

New issues arrive with the `needs-triage` label from the issue templates.

1. **Reproduce or clarify.** Ask for a minimal frame or payload if one is
   missing. Make sure the report contains no credentials, certificates, or
   production identifiers; edit them out if needed.
2. **Label.** Add a type (`bug`, `enhancement`, `documentation`, `question`),
   the package label (`pkg/core`, `pkg/schema-utils`, `pkg/validator`,
   `pkg/simulator`, `pkg/builder`, `pkg/testing`, `pkg/schemas`, `pkg/cli`), and
   remove `needs-triage`.
3. **Route.** Move usage questions to Discussions. Close out-of-scope requests
   with a link to the [roadmap non-goals](../ROADMAP.md#non-goals).
4. **Invite contributors.** Mark small, well-described issues as
   `good first issue` and issues open to anyone as `help wanted`. A good first
   issue names the files to change, the expected behavior, and how to test it.

Security reports never go through public triage; handle them in a private
advisory as described in [SECURITY.md](../SECURITY.md).

## Reviewing pull requests

- Check that the change fits the [package boundaries](../CONTRIBUTING.md#package-boundaries)
  and the [architecture](ARCHITECTURE.md).
- Require a changeset for every change to a published package's behavior or API,
  and edit its text so it reads well as a release note.
- Require documentation updates that follow the [style guide](STYLE.md).
- Squash-merge with a Conventional Commits title.

## Releases

Run the manual Release workflow as described in [RELEASING.md](RELEASING.md).
Before publishing, read the generated changelog entries and the GitHub release
notes: they are the public record of the change.

## Periodic tasks

- Review [SECURITY-BASELINE.md](SECURITY-BASELINE.md) at every release and by
  its review date.
- Keep the README status, the [API inventory](API-INVENTORY.md) versions, and
  the [roadmap](../ROADMAP.md) current after each release.
- Keep a few `good first issue` and `help wanted` issues open.
- Re-record the [demos](../scripts/demos/README.md) when a release changes the
  output they show.
