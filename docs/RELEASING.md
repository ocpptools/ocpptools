# Releasing

This document is the operational runbook for npm releases. `docs/BRANCHING.md`
remains the source of truth for branches and tags; this file covers trusted
publishing, provenance, first publishes, and failure recovery.

Publishing is CI-only. Never run `npm publish` or `pnpm release` locally.

## Package inventory

The owner keeps this table current. A package is releasable only when the
publisher is configured and a recent OIDC release is recorded.

| Package                   | Version | Trusted publisher | Allowed actions | Last OIDC       | Token              |
| ------------------------- | ------- | ----------------- | --------------- | --------------- | ------------------ |
| `@ocpptools/core`         | 0.3.0   | owner to verify   | `npm publish`   | owner to verify | owner to verify    |
| `@ocpptools/schema-utils` | 0.3.0   | owner to verify   | `npm publish`   | owner to verify | owner to verify    |
| `@ocpptools/validator`    | 0.3.0   | owner to verify   | `npm publish`   | owner to verify | owner to verify    |
| `@ocpptools/simulator`    | 0.4.0   | owner to verify   | `npm publish`   | owner to verify | owner to verify    |
| `@ocpptools/builder`      | 0.1.0   | owner to verify   | `npm publish`   | owner to verify | owner to verify    |
| `@ocpptools/schemas`      | 0.1.0   | owner to verify   | `npm publish`   | owner to verify | owner to verify    |
| `ocpptools`               | 0.1.1   | owner to verify   | `npm publish`   | owner to verify | owner to verify    |
| `@ocpptools/testing`      | 0.1.1   | configured        | `npm publish`   | 0.1.1           | no longer injected |

## Configure a trusted publisher

For each package in npm:

1. Open the package → Settings → Trusted Publisher → GitHub Actions.
2. Organization: `ocpptools`.
3. Repository: `ocpptools`.
4. Workflow filename: `release.yml`.
5. Environment: `release`.
6. **Allowed actions: `npm publish`.**

New configurations can default to `npm stage publish`. Changesets does not
support staged publishing, so a stage-only configuration will not publish.
Verify the allowed action after saving.

A new configuration expires if it does not publish within two days. Configure it
immediately before a real patch release, or coordinate a patch release for
several packages inside that window. Record the date, version, allowed actions,
and attestation URL.

## First publish

A package that does not exist on npm needs a first publish before a trusted
publisher can be configured.

1. Use a short-lived granular token in the `release` environment.
2. Publish the first version through `release.yml`.
3. Create the trusted publisher with `npm publish` allowed.
4. Publish the next patch by OIDC within two days to validate the publisher.
5. Record the attestation.
6. Retire the token only after the OIDC release is green.

For `@ocpptools/testing`:

- `0.1.0` uses the token.
- Configure the trusted publisher.
- `0.1.1` uses OIDC within two days.
- Retire the token.

After January 2027, 2FA-bypass tokens can only stage. If a new package needs its
first publish after that date, use `npm stage publish` to create the
`0.0.0-stage` placeholder, approve it with 2FA, configure the trusted publisher,
and publish the next patch by OIDC.

## Release flow

1. Merge a change to `main` with a changeset when a public package changes.
2. Run the manual **Release** workflow.
3. If changesets exist, Changesets opens the version pull request.
4. Review the version PR, then merge it.
5. Run **Release** again. It builds, packs, and publishes.
6. Approve the `release` environment.
7. Verify the version, provenance, tag, and GitHub Release.

`@ocpptools/testing` is private until its gate is approved. The release workflow
runs `pnpm check:testing-gate` before Changesets; a public testing package
without a recorded decision fails the run.

## Verify a release

```bash
npm view @ocpptools/<pkg> version dist-tags dist.attestations.provenance
npm view @ocpptools/<pkg>@<version> dependencies
```

Check:

- `dist-tags.latest` is the expected version.
- `dist.attestations.provenance.predicateType` is present.
- The tag `@ocpptools/<pkg>@<version>` exists.
- The GitHub Release exists.
- A temporary consumer installs from the registry and imports the package.
- The tarball has no schemas, secrets, or tests.

## Token retirement

Do not revoke the token before OIDC has published at least one version of every
package.

1. Configure and verify trusted publishers with `npm publish` allowed.
2. Run a real patch release without `NODE_AUTH_TOKEN` in the publish path while
   the secret still exists.
3. Verify provenance.
4. Restrict packages to "Require 2FA and disallow tokens" where npm supports it.
5. Remove `NODE_AUTH_TOKEN`/`NPM_TOKEN` from the workflow.
6. Revoke the token in npm.
7. Delete the GitHub secret.
8. Document a one-time granular-token procedure for future new packages.

## Release workflow security

The current workflow keeps install, build, version, and publish in one job. When
it is split, follow these rules:

- `id-token: write` only on the publish job.
- `contents: write` and `pull-requests: write` only where the version PR needs
  them.
- Do not cache pnpm in the release job.
- Use a GitHub App for `CHANGESETS_TOKEN` when possible; otherwise use a
  fine-grained repository PAT with a short expiry and a named rotation owner.
- Do not expose `CHANGESETS_TOKEN` to the publish job.
- Require reviewers on the `release` environment.
- Run CI and `pnpm test:pack` for the exact commit before publishing.
- Keep the testing gate before `pnpm release`.

## Partial release or failure

- npm versions are immutable. Never re-publish or reuse a version.
- If one package publishes and another fails, fix the failure and publish a patch
  for the remaining packages.
- Do not move a protected tag. Create a new tag/release.
- If a bad version is published, deprecate it with a clear message and publish a
  patch. Do not unpublish unless the registry policy and legal review allow it.
- Re-running the workflow is safe only when Changesets reports no pending
  versions; verify before approving.

## Hotfix

1. Create `hotfix/<scope>-<description>` from `main`.
2. Add the fix and tests.
3. Add a patch changeset.
4. Open the PR, pass CI, squash-merge with DCO.
5. Run the release workflow and verify provenance.

## New package

1. Add the package privately (`private: true`, `0.0.0`).
2. Complete tests, package checks, README, and ADR.
3. Publish the first version with a temporary token.
4. Configure the trusted publisher.
5. Publish the next patch by OIDC.
6. Retire the token if no other first publish is pending.

## Incident: compromised token

1. Revoke the token in npm.
2. Delete the GitHub secret.
3. Rotate `CHANGESETS_TOKEN`.
4. Audit recent release runs and published versions.
5. Deprecate affected versions and publish patches.
6. Record the incident and notify consumers if needed.
