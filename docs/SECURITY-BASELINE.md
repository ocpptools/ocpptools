# Security baseline

- Date: 2026-11-11
- Repository: <https://github.com/ocpptools/ocpptools>
- OpenSSF Scorecard: 6.3 (2026-11-11, commit `25c40b1`)
  <https://api.securityscorecards.dev/projects/github.com/ocpptools/ocpptools>

This is a baseline, not a claim that every score is maximal. Each item has an
owner, a decision, and a trigger.

## Controls

| Control                         | Status         | Evidence or decision                                                                                                                                                                |
| ------------------------------- | -------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Branch rules                    | Active         | Repository rulesets `main` and `release-tags` are active. The `main` ruleset requires pull requests and status checks.                                                              |
| Required approvals              | Gap            | The owner is the only reviewer, so required approvals and CODEOWNERS review are not enabled. Add them when a second maintainer joins.                                               |
| DCO                             | Active         | `.github/workflows/dco.yml` requires a `Signed-off-by` trailer.                                                                                                                     |
| CodeQL                          | Active         | `.github/workflows/codeql.yml`; Scorecard SAST 10/10.                                                                                                                               |
| Dependency Review               | Active         | `.github/workflows/dependency-review.yml` runs on pull requests.                                                                                                                    |
| Dependabot                      | Active         | `.github/dependabot.yml`; security updates enabled.                                                                                                                                 |
| Secret scanning                 | Active         | Secret scanning and push protection are enabled. Non-provider patterns and validity checks are disabled; enable them when the owner reviews the false-positive load.                |
| Private vulnerability reporting | Active         | The repository setting is enabled; `SECURITY.md` explains the process.                                                                                                              |
| Production audit                | Active         | `pnpm audit --prod` runs in CI and reports no known production vulnerabilities.                                                                                                     |
| Dev-only advisory               | Accepted       | `minimatch@10.2.6` (GHSA-g3hv-75wg-m249) is pulled by ESLint 10 and Typedoc. It is dev-only and not shipped. Re-check when ESLint updates its range; do not force a major override. |
| Pinned actions                  | Active         | Every `uses:` is pinned to a 40-character commit SHA; `scripts/check-workflow-pins.mjs` enforces it.                                                                                |
| Token permissions               | Active         | Workflows use read-only defaults and grant write only to the release job.                                                                                                           |
| SBOM                            | Active         | The release workflow uploads one CycloneDX 1.6 SBOM per published package.                                                                                                          |
| Release provenance              | Active         | npm trusted publishing with SLSA provenance. Signed git tags are not used; see `docs/RELEASING.md`.                                                                                 |
| TypeDoc hosting                 | Deferred       | CI generates the API docs. Hosting needs a durable site and a deployment owner; not part of launch.                                                                                 |
| CII Best Practices badge        | Deferred       | Not requested. The owner can apply after launch if it adds value.                                                                                                                   |
| Fuzzing                         | Deferred       | The parser and frame boundaries have property-style tests but no fuzzer. Add a fuzz target when a consumer needs it or before a 1.0 parser freeze.                                  |
| Second maintainer / code review | Gap            | Solo-owner project. Scorecard Code-Review is 0 until a second reviewer is active.                                                                                                   |
| Packaging score                 | Not applicable | Scorecard does not detect the Changesets release workflow. The release path is tested and documented.                                                                               |

## OpenSSF Scorecard reading

- 10/10: Pinned-Dependencies, Token-Permissions, Dangerous-Workflow,
  Dependency-Update-Tool, Binary-Artifacts, License, SAST, CI-Tests.
- 9/10: Vulnerabilities (the dev-only `minimatch` advisory above).
- 4/10: Security-Policy (the file exists and private reporting is enabled; the
  score penalizes the missing external link and disclosure timeline).
- 3/10: Branch-Protection (rulesets exist, but required approvals, stale review
  dismissal, last-push approval, and admin enforcement are off).
- 0: Code-Review, Maintained, CII-Best-Practices, Fuzzing, Contributors. The
  first four are owner decisions or repo-age effects, not code defects.

## Owner actions

1. Decide whether to enable required approvals and CODEOWNERS review once a
   second maintainer exists.
2. Review the secret-scanning non-provider patterns and validity checks.
3. Decide whether to pursue the CII Best Practices badge.
4. Keep the TypeDoc hosting decision deferred until a durable site exists.

## Review

Review this baseline at every release, when GitHub changes a security feature,
or by 2027-01-31, whichever comes first.
