# Demo recordings

Sources and scripts for the demo files in `docs/assets/`. Each demo has a GIF
for the documentation pages and an MP4 of the same recording.

| Files                           | Shows                                                                                  | Used in                                          | Recorded with                                     |
| ------------------------------- | -------------------------------------------------------------------------------------- | ------------------------------------------------ | ------------------------------------------------- |
| `cli-demo.gif`, `.mp4`          | `ocpptools validate` on a valid and an invalid frame, then a five-step `simulate` run  | Root README, CLI README, simulate guide          | [VHS](https://github.com/charmbracelet/vhs)       |
| `cli-ci.gif`, `.mp4`            | A CALLRESULT checked without and with `--action`, then `--json` output                 | Validate-in-CI guide                             | VHS                                               |
| `testing-vitest.gif`, `.mp4`    | Vitest running the two samples of the test-without-a-network guide                     | Testing README, test-without-a-network guide     | VHS                                               |
| `simulator-code.gif`, `.mp4`    | `terminal/fixtures/station.mjs` driving a simulated 2.0.1 station from code            | Simulator README, simulate guide                 | VHS                                               |
| `browser-validator.gif`, `.mp4` | `@ocpptools/validator` in a browser page: a valid frame, then a missing required field | Validator README, validator-in-the-browser guide | [webreel](https://github.com/vercel-labs/webreel) |

The demos run the **published npm packages**, not the workspace build, so they
show what users install. Update the pinned versions in `record-terminal.mjs`
and `record-browser.mjs` after a release that changes the output.

Package READMEs link the GIFs with absolute `raw.githubusercontent.com` URLs on
`main`, because npm does not resolve relative image paths. Repository pages use
relative paths. GitHub does not play MP4 files from the repository inline, so
the pages link to them.

## Prerequisites

- Node.js 22.12 or newer and npm.
- For the terminal demos: VHS 0.11.0 or newer, `ttyd`, and `ffmpeg` on `PATH`.
  On Windows: `winget install charmbracelet.vhs tsl0922.ttyd Gyan.FFmpeg`. VHS
  drives a local Chrome or Edge.
- For the browser demo: `ffmpeg` on `PATH`. webreel downloads its own
  `chrome-headless-shell` to `~/.webreel` on first run.
- Ports 9000 (synthetic CSMS) and 4173 (demo page) must be free.

## Record

From the repository root:

```sh
node scripts/demos/record-terminal.mjs
node scripts/demos/record-browser.mjs
```

`record-terminal.mjs` records every tape in `terminal/tapes/`. To record some of
them, pass their names:

```sh
node scripts/demos/record-terminal.mjs --only cli-ci --only testing-vitest
```

Each script works in a new temporary directory, installs pinned package
versions there, renders the files, and copies only the results into
`docs/assets/`. The temporary directory is kept and printed so you can inspect
it. Nothing is added to the workspace dependencies.

## Layout

- `terminal/tapes/` holds one VHS tape per terminal demo. The script fills in
  the `{{...}}` values: output paths, shell, font, and a hidden setup command
  that sets the prompt, the working directory, and `PATH`.
- `terminal/fixtures/` is copied into the directory the tapes run in: the
  frames, the simulator config and scenario, `station.mjs`, and
  `station.test.mjs` with its `vitest.config.mjs`. The repository test suite
  does not run `station.test.mjs`.
- `terminal/csms.mjs` is the synthetic CSMS for the simulator demos.
- `browser/` is the page, its script, and the webreel config of the browser
  demo.

## What is real and what is synthetic

- Every visible command and every result comes from the real published
  packages. Nothing is typed into the output or edited afterwards.
- The simulator demos connect to `terminal/csms.mjs`, a synthetic CSMS on
  `127.0.0.1:9000` that only answers the calls of the scenarios.
- The frames, station data, and ID token are synthetic.
- The Vitest config replaces only the first line of the report, which would
  show the absolute path of the temporary directory, with the Vitest version.
- `browser/` is a minimal page made for the recording. It is not a product.
  `browser/webreel.json` is the webreel config; the script copies it into the
  workspace as `webreel.config.json`.

## Check a recording

Before you replace a file in `docs/assets/`, look at it at full size: the first
and last frames, and a frame per second in between. Check that the text is
readable, nothing is cut off, and no local path, user name, or host appears.
For example:

```sh
ffmpeg -i docs/assets/cli-demo.gif -vf fps=1 /tmp/cli-frames/frame-%03d.png
```

## Known issues

`record-browser.mjs` patches webreel 0.1.4 inside the temporary workspace:

- The `type` step looks up its target by the text to type instead of the
  selector.
- The recorder never reads ffmpeg's output, which can stall the recording.
- On Windows, Chrome's begin-frame control stalls screenshots, and key `char`
  events insert no text in `chrome-headless-shell`.

The script fails if the patched code no longer matches, so a new webreel version
needs a review of these patches.
