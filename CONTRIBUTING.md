# Contributing to OCPP Tools

Thank you for helping. Contributions of every size are welcome: a typo fix, a
clearer error message, a failing test for a bug, an example, or a new feature.

Everyone who takes part follows the [Code of Conduct](CODE_OF_CONDUCT.md).

## Ways to contribute

- **Report a bug** with a minimal frame or payload that reproduces it.
- **Improve the documentation**: READMEs, guides in `docs/`, and code samples.
- **Add tests**, especially for OCPP edge cases and errata.
- **Fix an issue.** Issues labeled
  [`good first issue`](https://github.com/ocpptools/ocpptools/labels/good%20first%20issue)
  are small and well scoped. Issues labeled
  [`help wanted`](https://github.com/ocpptools/ocpptools/labels/help%20wanted)
  are open for anyone.
- **Answer questions** in
  [GitHub Discussions](https://github.com/ocpptools/ocpptools/discussions).
- **Share how you use the packages.** Real consumer feedback decides what
  becomes stable.

## Before you start

| Change                                | What to do first                                                                                 |
| ------------------------------------- | ------------------------------------------------------------------------------------------------ |
| Typo, docs, test, or small bug fix    | Open a pull request directly.                                                                    |
| Bug fix that changes behavior         | Open or find an issue, then a pull request that links it.                                        |
| New feature or public API change      | Open a feature request or a discussion first, so the design is agreed before you write the code. |
| Cross-package or architectural change | Propose an [Architecture Decision Record](docs/ADR/README.md) in a discussion or pull request.   |
| Security vulnerability                | Do not open an issue. Follow [SECURITY.md](SECURITY.md).                                         |

Check the [roadmap](ROADMAP.md) and its non-goals before proposing a feature.
Hosted services, UI components, and edited copies of the OCPP schemas are out
of scope.

## Set up the repository

You need Node.js 22.12 or newer, Git, and pnpm 11. The exact pnpm version is
pinned in the `packageManager` field of the root `package.json`; you can install
it with `corepack enable` or `npm install --global pnpm`.

```sh
git clone https://github.com/<your-user>/ocpptools.git
cd ocpptools
pnpm install
pnpm test
```

`pnpm test` runs every unit test. Tests run against the TypeScript sources, so
you do not need to build first.

On Windows, use Git Bash or WSL for the shell commands in this guide.

### Work on one package

```sh
pnpm vitest run packages/validator          # run the tests of one package
pnpm vitest packages/validator              # re-run them on every change
pnpm vitest run packages/core/test/parse.test.ts   # run one test file
pnpm build                                  # build every package (needed for examples)
```

| Folder                  | npm package               |
| ----------------------- | ------------------------- |
| `packages/core`         | `@ocpptools/core`         |
| `packages/schema-utils` | `@ocpptools/schema-utils` |
| `packages/validator`    | `@ocpptools/validator`    |
| `packages/simulator`    | `@ocpptools/simulator`    |
| `packages/builder`      | `@ocpptools/builder`      |
| `packages/testing`      | `@ocpptools/testing`      |
| `packages/schemas`      | `@ocpptools/schemas`      |
| `packages/cli`          | `ocpptools`               |
| `examples/*`            | Not published             |

## Make a change

1. **Fork** the repository and create a branch from `main`, for example
   `fix/validator-error-path` or `docs/simulator-guide`. See the
   [branch prefixes](docs/BRANCHING.md#short-lived-branches).
2. **Make the smallest change** that solves the problem.
3. **Add or update tests** for every behavior change.
4. **Update the documentation** when behavior or a public API changes. Follow
   the [documentation style guide](docs/STYLE.md).
5. **Add a changeset** if a published package changes (see below).
6. **Sign off every commit** (see below).
7. **Open a pull request** against `main` and fill in the template.

### Commit messages and pull request titles

Pull requests are squash-merged, so the pull request title becomes the commit
on `main`. It must follow [Conventional Commits](https://www.conventionalcommits.org/):

```text
feat(validator): report the expected enum values
fix(simulator): stop meter loops on disconnect
docs(cli): document --no-schema
```

Use the package folder name as the scope (`core`, `schema-utils`, `validator`,
`simulator`, `builder`, `testing`, `schemas`, `cli`) or an area such as
`release`, `security`, or `deps`. Commit messages inside your branch are free,
but they need a sign-off.

### Developer Certificate of Origin

Contributions are accepted under the
[Developer Certificate of Origin](https://developercertificate.org/) (DCO).
There is no CLA. Sign off each commit with `-s`:

```sh
git commit -s -m "fix(core): accept an empty CALLERROR description"
```

This adds a `Signed-off-by: Your Name <you@example.com>` line, which certifies
that you wrote the change or have the right to submit it under the project
license. The `DCO` check fails without it. To fix a missing sign-off:

```sh
git commit --amend -s --no-edit          # the last commit
git rebase --signoff main                # every commit in the branch
git push --force-with-lease              # only on your own branch
```

### Changesets

A changeset records a release note and the version bump for each package you
changed. Add one when a published package changes its behavior or public API.
Documentation-only, test-only, and CI-only changes do not need one.

```sh
pnpm changeset
```

Choose the packages, the bump (`patch` for fixes, `minor` for features and,
before 1.0.0, for breaking changes), and write one or two sentences for users.
The text goes into the changelog and the GitHub release, so describe the effect,
not the implementation.

## Check your change

`pnpm verify` runs the CI checks except the production dependency audit and the
browser end-to-end tests. Run it before you ask for a review. The root
`package.json` is the source of truth for every command.

```sh
pnpm verify
```

It needs [REUSE](https://reuse.software/) for the license check
(`pipx install "reuse[charset-normalizer]"`). If you cannot install it, run the
other steps and let CI run the REUSE check.

<details>
<summary>What <code>pnpm verify</code> runs, in order</summary>

1. `pnpm lint` and `pnpm format:check`
2. `pnpm typecheck` and `pnpm typecheck:test`
3. `pnpm test:coverage`, `pnpm test:coverage:builder`, and
   `pnpm test:coverage:testing`
4. `pnpm build`
5. `pnpm test:examples` (the examples install the built workspace packages)
6. `pnpm bundle:check` (the consumer bundle must not load unused schemas)
7. `pnpm lint:packages` (`publint`, `attw`) and `pnpm test:pack` (installs the
   packed tarball in a throwaway project)
8. `pnpm docs:api` and `pnpm size`
9. `pnpm check:api-inventory`, `pnpm check:workflow-pins`, and
   `pnpm check:testing-gate`
10. `pnpm lint:ai-files`, `pnpm lint:schemas`, and `pnpm lint:licenses`

`pnpm format` fixes formatting. Coverage starts at 80% for the workspace, and at
90% (85% for branches) for `builder` and `testing`. Thresholds should ratchet
upward, never down.

</details>

## What happens after you open a pull request

1. CI runs the checks above on Node.js 22 and 24, plus a production dependency
   audit, browser end-to-end tests of the simulator, CodeQL, dependency review,
   the DCO check, and the title check.
2. A maintainer reviews the pull request. The project is maintained on a
   best-effort basis (see [SUPPORT.md](SUPPORT.md)), so a review can take some
   days.
3. When the checks pass and the review is approved, a maintainer squash-merges
   it.
4. Your changeset ships with the next release, through the release process in
   [docs/RELEASING.md](docs/RELEASING.md).

## Project rules

These rules keep the packages small, portable, and legally clean. CI enforces
most of them.

### Package boundaries

| Package        | Owns                                                    | Must not contain                                      |
| -------------- | ------------------------------------------------------- | ----------------------------------------------------- |
| `core`         | Types, frames, parser, serializer, transport interfaces | Ajv, DOM, schemas                                     |
| `schema-utils` | Pure JSON Schema normalization and field metadata       | OCPP knowledge, I/O                                   |
| `validator`    | Ajv validation with an injectable schema registry       | DOM, bundled schemas                                  |
| `simulator`    | Headless protocol engine; browser and Node adapters     | DOM in the engine, UI, Ajv, schemas                   |
| `builder`      | Headless payload and frame construction                 | UI, schemas, action lists                             |
| `testing`      | Test doubles and deterministic helpers                  | Schemas, action lists, Ajv, `ws`, DOM, Node built-ins |
| `schemas`      | Unmodified OCA JSON Schemas with their license          | Any edit, formatting, or generated file               |
| `cli`          | Command-line wrapper over validator and simulator       | Protocol or schema logic of its own                   |

Keep exported API boundaries on `unknown`, not `any`. See
[docs/ARCHITECTURE.md](docs/ARCHITECTURE.md) for how the packages fit together.

### Tests

- Use Vitest, and add tests with every behavior change.
- Do not copy untested code from another repository into a package.
- Write synthetic fixtures (`urn:example:...`, `Acme`, `CP001`), never a copy
  of an OCPP schema.

### OCPP schemas and legal

- The OCPP JSON Schemas belong to the Open Charge Alliance (CC BY-ND 4.0). They
  live only in `packages/schemas/schemas`, as byte-for-byte copies. Do not
  edit them, and do not add schemas, copies, or schema-derived files anywhere
  else. `pnpm lint:schemas` fails CI otherwise.
- Code and documentation are Apache-2.0. Contributions are inbound = outbound
  under Apache-2.0 with the DCO.
- New source files start with the SPDX header used in the existing files.

### Repository content

- Public documentation is written in English.
- The repository holds packages, tooling, and their documentation only. Do not
  add website content, SEO pages, ads, analytics, deployment configuration,
  private assets, or the private website's name or URL.
- Do not commit AI-assistant configuration files (instructions, rules, prompts,
  memory, local settings, or `AGENTS.md`). They are ignored by Git, and
  `pnpm lint:ai-files` fails CI if one is tracked. Using tools to write code is
  fine; you are responsible for every line you submit, and the DCO applies to
  it.

## Get help

Ask in [GitHub Discussions](https://github.com/ocpptools/ocpptools/discussions)
or comment on the issue you are working on. See [SUPPORT.md](SUPPORT.md).

Maintainers: the release process, branch protection, and other maintainer tasks
are in [docs/MAINTAINING.md](docs/MAINTAINING.md).
