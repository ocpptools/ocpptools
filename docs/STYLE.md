# Documentation style guide

This guide keeps the READMEs and the documents in `docs/` consistent. Follow it
when you add a package, a guide, or a section. Reviewers check new docs against
it.

## Principles

- **A README is a front page, not a manual.** It answers what the package is,
  who it is for, how to install it, and how to try it in under a minute.
  Everything else goes to `docs/`.
- **One message.** The project tagline is the same in the GitHub repository
  description, the root README, the `CITATION.cff` abstract, and the root
  `package.json` description:

  > Validate, build, and simulate OCPP 1.6J and 2.0.1 messages in TypeScript:
  > in the browser, in Node, or in your CI.

  Each published package keeps its own one-sentence `description`, which its
  README repeats.

- **Write for users first.** Maintainer process belongs in
  [MAINTAINING.md](MAINTAINING.md) and the documents it links.
- **Document what is released.** A feature that is merged but not yet on npm
  says so, for example "ocpptools 0.2.0 and later".
- **English, plain, and short.** Use active voice and present tense. Prefer
  lists and tables to long paragraphs.

## Where documentation goes

The `docs/` folder follows the four kinds of documentation of the
[Diátaxis](https://diataxis.fr/) framework:

| Kind        | Purpose                    | Location                                    |
| ----------- | -------------------------- | ------------------------------------------- |
| Tutorial    | Learn by doing, end to end | `docs/getting-started.md`                   |
| How-to      | Solve one concrete task    | `docs/guides/`                              |
| Reference   | Look up exact behavior     | `docs/reference/`, package READMEs, TypeDoc |
| Explanation | Understand why it works so | `docs/ARCHITECTURE.md`, `docs/ADR/`, errata |

Maintainer documents (branching, releasing, security baseline, API inventory,
contingency plans) are listed in [MAINTAINING.md](MAINTAINING.md).

## Package README template

Every package README uses these sections, in this order. Leave out a section
only when it would be empty.

```md
# @ocpptools/<name>

<One sentence, identical to the `description` in package.json.>

[![npm](https://img.shields.io/npm/v/@ocpptools/<name>)](https://www.npmjs.com/package/@ocpptools/<name>)
[![License](https://img.shields.io/npm/l/@ocpptools/<name>)](https://github.com/ocpptools/ocpptools/blob/main/LICENSE)

> **Status:** alpha. The API can change in any minor release before 1.0.0.

## When to use it

## Install

## Quick start

## <Task-oriented sections>

## API

## Limits

## Related packages

## License
```

Rules:

- **Length.** Aim for 150 lines or fewer. Move longer reference material to
  `docs/reference/` and link to it.
- **Status line.** Use the sentence above, unchanged, in every code package.
  `@ocpptools/schemas` has no API, so its status line states the schema license
  caveat instead.
- **When to use it.** Two to four bullets: who needs the package, and which
  sibling package to use instead when it is the wrong one.
- **Quick start.** At most about 20 lines. It must run when it is copied into a
  new project, with no workspace setup. A longer quick start is acceptable only
  when a README test runs it (for example
  `packages/schema-utils/test/readme.test.ts`); keep both in sync.
- **API.** A package whose API is documented in `docs/reference/` may use a
  `## Reference` section that links there instead of `## API`.
- **Legal sections.** `@ocpptools/schemas` adds "Author and source" and "Not
  affiliated with the OCA" next to its License section. Their wording is legal
  text; see [Standard texts](#standard-texts).
- **Related packages.** A short list of sibling packages and how they combine.
- **License.** End with the standard notice below.

## Standard texts

Copy these exactly. Changing their wording changes legal text, so do it in a
dedicated pull request.

**Affiliation notice** (every package README, in the License section, and in the
root README):

> OCPP is a specification of the Open Charge Alliance. This project is not
> affiliated with, endorsed by, or certified by the Open Charge Alliance.

**License line** (packages without OCA files):

> Apache-2.0. See the repository `LICENSE` and `NOTICE`.

`@ocpptools/schemas` keeps its own, longer attribution and license sections.
Do not shorten them.

## Links and images

- **Use absolute URLs in package READMEs.** npm renders the README of the
  tarball, where relative links to other folders break. Use
  `https://github.com/ocpptools/ocpptools/blob/main/<path>`.
- Files that ship next to the README in the tarball (for example `SOURCES.md` in
  `@ocpptools/schemas`) may be linked relatively.
- Root and `docs/` documents may use relative links.
- Images need alternative text and an absolute URL. Store them under
  `docs/assets/`.

## Code samples

- Show imports in every sample.
- Use synthetic or clearly example data: `CP001`, `Acme`, `AABBCCDD`,
  `wss://csms.example.com/CP001`, `urn:example:...`.
- Never paste an OCPP JSON Schema, or a fragment of one, into documentation.
  `pnpm lint:schemas` fails on files that look like OCA schemas outside
  `packages/schemas/schemas`.
- Use `ts` for TypeScript, `js` for JavaScript, `sh` for shell commands, `json`
  for data, and `text` for file trees and output.
- Show the output as a comment or as a separate `text` block.

## Badges

- Root README: CI, npm version of the CLI, license, OCPP versions, Node.js
  version, and the OpenSSF Scorecard.
- Package READMEs: npm version and license only.
- Do not add badges for downloads or stars.

## Headings and wording

- One `#` heading per file. Sections use `##`, subsections `###`.
- Headings are sentence case and name a task or a thing: "Validate a frame",
  "Limits". Avoid "Introduction" and "Overview".
- Write OCPP versions as `OCPP 1.6J` and `OCPP 2.0.1`. In code and options, use
  the values the API accepts: `'1.6'` and `'2.0.1'`.
- Refer to the Open Charge Alliance by its full name on first use in a document,
  then "the OCA".

## Formatting

Run `pnpm format` before committing. Prettier formats Markdown with the
repository settings.
