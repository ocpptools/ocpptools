# OCA schema contingency

- Date: 2026-11-11
- Status: prepared; not activated.
- Trigger: the Open Charge Alliance objects to `@ocpptools/schemas`, or a legal
  review requires removing the verbatim schema copies.

## Inventory

| Location                                          | Copies                             | Removable                                |
| ------------------------------------------------- | ---------------------------------- | ---------------------------------------- |
| `packages/schemas/schemas/1.6`                    | 56 verbatim OCA files              | Yes; the package is self-contained.      |
| `packages/schemas/schemas/2.0.1`                  | 128 verbatim OCA files             | Yes.                                     |
| `packages/schemas/manifest.json` and `SOURCES.md` | hashes and provenance              | Yes, together with the package.          |
| Site `docs/ocpp1.6j` and `docs/ocpp2.0.1`         | none                               | Removed in site PR #5.                   |
| Other packages                                    | none                               | They load schemas at runtime; no copies. |
| CLI                                               | dependency on `@ocpptools/schemas` | Replaceable with `--no-schema`.          |

`pnpm lint:schemas` fails if a schema copy appears outside
`packages/schemas/schemas`.

## CLI fallback

`ocpptools validate --no-schema <frame> --version <1.6|2.0.1>` uses a
permissive schema for every action:

- JSON parsing, the frame layout, message IDs, message types, and the per-version
  CALLERROR code set are still checked.
- Payload fields are not checked against the OCA schemas.
- The result is `valid` for a well-formed frame with any payload.
- A malformed frame is still invalid.

Test: `packages/cli/test/validate.test.ts` ("skips the payload schema with
`--no-schema` but still checks the frame").

## Withdrawal sequence

1. Deprecate `@ocpptools/schemas` with a clear message and a removal date.
2. Publish patch releases of `validator`, `builder`, `testing`, the simulator,
   and the CLI that do not require the schema package at runtime.
3. Change the CLI default to `--no-schema` or require an explicit registry; keep
   the flag for compatibility.
4. Remove the site schema imports and the validator/builder pages that depend on
   them, or serve a user-provided schema.
5. Remove `packages/schemas` from the workspace and CI.
6. Keep the public README, NOTICE, and the OCA attribution accurate.

Do not promise an npm unpublish. npm versions are immutable; deprecation and a
replacement release are the supported path.

## Owner actions

1. Send the formal OCA query and keep the correspondence private.
2. Obtain legal review before activating this plan.
3. Decide whether the site keeps a schema-based validator or moves to the
   frame-only mode.
4. Record the decision and the date in `ROADMAP.md` or a new ADR.
