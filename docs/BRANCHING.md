# Branching and Git Workflow

This document defines how branches, pull requests, merges, hotfixes, and
maintenance releases work in this repository. It is the source of truth for the
Git workflow. Configuration that enforces it lives in the GitHub repository
settings and in CI.

## Permanent branches

`main` is the only permanent branch. It is protected, always releasable, and
receives changes only through pull requests. No direct pushes are allowed.

## Short-lived branches

Work branches are temporary and are deleted after merge.

Use these prefixes:

- `feat/` — new functionality.
- `fix/` — bug fixes.
- `docs/` — documentation.
- `chore/` — maintenance and housekeeping.
- `refactor/` — internal changes that do not change public behavior.
- `test/` — tests and test infrastructure.
- `perf/` — performance work.
- `ci/` — continuous integration and workflows.
- `build/` — build system, tooling, and dependency changes.
- `revert/` — reverting a previous change.
- `hotfix/` — urgent fixes for a released version.

Branch names use lowercase, hyphens, and a short description. Use a package or
area scope when it helps.

Examples:

```text
feat/core-frame-parser
fix/validator-ajv-error-path
docs/branching-policy
hotfix/core-callerror-parsing
```

## Daily workflow

1. Branch from `main`.
2. Open a pull request early, even as a draft.
3. Keep the branch short-lived. Split large changes.
4. Update the branch by merging `main` into it. Do not rebase a shared branch.
5. Add or update tests for every behavior change.
6. Add a changeset when a public package API changes.
7. Squash-merge after checks and review pass.
8. Delete the branch after merge.

## Pull requests

Every pull request needs:

- A title in Conventional Commits format, because the squash merge uses the
  pull request title.
- A description of the problem and the solution.
- Tests for behavior changes.
- A changeset when a public package API changes.
- DCO sign-off on commits.
- Documentation updates when behavior or APIs change.
- No secrets, private content, private website references, or OCPP schemas.
- One coherent change. Large changes should be split.

## Merge policy

- Squash merge only.
- Linear history on `main`.
- No merge commits on `main`.
- No force pushes to `main`.
- No deleting `main`.
- Conversations must be resolved before merge.
- Required approvals are zero while the maintainer team has one person, and
  become one when a second maintainer is added.
- Branches are deleted automatically after merge.

## Required checks

The following checks must pass before merge:

- Lint.
- Format check.
- Typecheck.
- Tests.
- Build.
- Package checks (`publint`, `attw`).
- CodeQL.
- Dependency review.
- DCO.

When CI exists, update this section with the exact workflow and job names.

## Releases

`main` is the release line. Routine releases do not use release branches.

The release flow is:

1. A change merges to `main` with a changeset when a public package changes.
2. Changesets opens a release pull request.
3. The release pull request is merged.
4. CI publishes packages with OIDC and provenance.
5. Tags are created in the package format, for example `@ocpptools/core@0.1.0`.

Publishing is CI-only. Maintainers do not publish from local machines. Tags are
immutable and protected.

## Hotfixes

For the current release line:

1. Create `hotfix/<scope>-<description>` from `main`.
2. Open a pull request with tests and a changeset.
3. Squash-merge and release a patch version.

Fixes land on `main` first. If an older release line is still supported,
cherry-pick the fix to the matching maintenance branch after the fix is merged.

## Maintenance branches

Maintenance branches exist only when more than one major release line is
supported.

```text
release/0.x
release/1.x
release/2.x
```

Rules:

- A maintenance branch starts from a stable tag.
- It receives fixes, security updates, and documentation only.
- It does not receive new features.
- It is protected like `main`.
- It is deleted when the release line reaches end of life.
- It is not created for routine releases.

## External contributors

External contributors work from a fork:

1. Fork the repository.
2. Branch from `main` in the fork.
3. Open a pull request against the upstream `main`.
4. Sign commits with the DCO.

Branch names inside a fork are free. Maintainers do not push to a contributor's
branch without permission.

## Branch protection and emergencies

`main`, maintenance branches, and release tags are protected. Force pushes and
deletions are not allowed.

Administrator bypass is allowed only for an emergency, such as restoring a
broken repository state or fixing a compromised release. After an emergency
bypass, the maintainers open a follow-up pull request and record what happened.

## Tags and prereleases

Release tags use the package format:

```text
@ocpptools/core@0.1.0
@ocpptools/validator@0.1.0
```

Tags are annotated, protected, and immutable. GitHub Releases are created from
those tags. Prereleases use npm dist-tags such as `next` or `canary`, not
long-lived branches.

## What this repository does not use

- Permanent integration branches.
- Staging or production branches.
- Routine release branches for every version.
- Long-lived prerelease branches.
- Direct pushes to `main`.

## Maintenance of this document

This document is the source of truth for branching and merging. Changes to the
workflow require a pull request. Structural changes to the release process are
recorded in an Architecture Decision Record.
