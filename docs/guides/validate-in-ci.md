# Validate OCPP frames in CI

Use the `ocpptools` CLI to fail a build when a recorded or generated OCPP frame
does not match the official OCPP JSON Schemas.

![The ocpptools CLI warns that a CALLRESULT was not checked, validates it with --action Heartbeat, then prints the result for an invalid BootNotification as JSON.](../assets/cli-ci.gif)

Also available as [video](../assets/cli-ci.mp4). The recording shows
[response validation](#validate-responses) and
[machine-readable output](#machine-readable-output).

## Validate one file

```sh
npx --yes ocpptools@0.1.1 validate fixtures/boot.json --version 2.0.1
```

Pin the CLI version you tested, so a new release cannot change your build.

| Exit code | Meaning                                                                        |
| --------- | ------------------------------------------------------------------------------ |
| `0`       | The frame is valid, possibly with warnings.                                    |
| `1`       | The frame is invalid.                                                          |
| `2`       | The file is missing or unreadable, the JSON is invalid, or an option is wrong. |
| `3`       | An unexpected internal failure occurred.                                       |

## Validate a folder

The CLI validates one frame per run. This loop validates every file, prints
every failure, and fails at the end if any file is invalid:

```sh
status=0
for file in fixtures/ocpp-2.0.1/*.json; do
  npx --yes ocpptools@0.1.1 validate "$file" --version 2.0.1 || status=1
done
exit "$status"
```

## Validate responses

A CALLRESULT does not name its action. Pass the action of the request, or the
payload is only reported with an `unchecked-result` warning:

```sh
npx --yes ocpptools@0.1.1 validate fixtures/heartbeat-response.json --version 2.0.1 --action Heartbeat
```

A practical layout is one folder per request action for responses, so the loop
can pass the folder name as `--action`.

## GitHub Actions

```yaml
name: OCPP fixtures

on:
  pull_request:
  push:
    branches: [main]

permissions:
  contents: read

jobs:
  validate:
    runs-on: ubuntu-24.04
    steps:
      - uses: actions/checkout@v7
      - uses: actions/setup-node@v7
        with:
          node-version: 22
      - run: npm install --global ocpptools@0.1.1
      - name: Validate OCPP 2.0.1 frames
        run: |
          status=0
          for file in fixtures/ocpp-2.0.1/*.json; do
            ocpptools validate "$file" --version 2.0.1 || status=1
          done
          exit "$status"
```

For a hardened workflow, pin each action to a full commit SHA instead of a
version tag.

## Machine-readable output

`--json` prints the `ValidationResult` of `@ocpptools/validator`: `status`,
`issues`, and `warnings`, where each issue has a `code`, a JSON `pointer`, and a
`message`. Use it to build a report or annotate a pull request:

```sh
npx --yes ocpptools@0.1.1 validate fixtures/boot.json --version 2.0.1 --json > result.json
```

## Validate inside your test suite

If your project already runs JavaScript tests, call the validator directly
instead of the CLI. See the [validator README](../../packages/validator/README.md)
and [Getting started](../getting-started.md#2-validate-from-code).

## Frame-only validation

From `ocpptools` 0.2.0, `--no-schema` checks the JSON, the frame layout, the
message ID, and the CALLERROR code set of the version, but not the payloads.
Use it if the OCA schema package cannot be used. The CLI still installs that
package as a dependency; the flag only skips loading the schemas. Earlier
versions reject the option.
