# OCPP Tools documentation

Start with the [getting-started tutorial](getting-started.md). Every package
also has a README with installation and a quick start.

## Tutorial

- [Getting started](getting-started.md): validate a frame from the command line
  and from code, then run a simulated charge point against a mock CSMS.

## How-to guides

- [Validate OCPP frames in CI](guides/validate-in-ci.md)
- [Run a simulated charge point against your CSMS](guides/simulate-against-a-csms.md)
- [Use the validator in the browser or with a bundler](guides/validator-in-the-browser.md)
- [Unit-test OCPP code without a network](guides/test-without-a-network.md)
- [Runnable examples](EXAMPLES.md)

## Reference

| Package                   | README                                       | Reference pages                                      |
| ------------------------- | -------------------------------------------- | ---------------------------------------------------- |
| `ocpptools` (CLI)         | [README](../packages/cli/README.md)          | [CLI reference](reference/cli.md)                    |
| `@ocpptools/core`         | [README](../packages/core/README.md)         |                                                      |
| `@ocpptools/validator`    | [README](../packages/validator/README.md)    |                                                      |
| `@ocpptools/simulator`    | [README](../packages/simulator/README.md)    | [Simulator reference](reference/simulator/README.md) |
| `@ocpptools/builder`      | [README](../packages/builder/README.md)      |                                                      |
| `@ocpptools/testing`      | [README](../packages/testing/README.md)      |                                                      |
| `@ocpptools/schema-utils` | [README](../packages/schema-utils/README.md) |                                                      |
| `@ocpptools/schemas`      | [README](../packages/schemas/README.md)      | [SOURCES.md](../packages/schemas/SOURCES.md)         |

The full exported API of every package is in the TypeDoc output. Generate it
locally with `pnpm docs:api`; it is written to `docs/api/`. The list of public
entrypoints and the compatibility rules are in the
[API inventory](API-INVENTORY.md).

## Explanation

- [Architecture](ARCHITECTURE.md): how the packages fit together and why.
- [Architecture Decision Records](ADR/README.md): every cross-package decision.
- [OCPP 2.0.1 errata](OCPP-2.0.1-ERRATA.md): how the packages apply the OCA
  errata.
- [Simulator reconnection policy](SIMULATOR-RECONNECTION.md) and
  [simulator timers](SIMULATOR-TIMERS.md).
- [Cryptography and ISO 15118 callbacks](security/crypto-15118.md): threat model
  and callback contract.
- [Project history](HISTORY.md): how the project was built, phase by phase.

## Project

- [Roadmap](../ROADMAP.md), [changelog index](../CHANGELOG.md), and
  [governance](../GOVERNANCE.md).
- [Contributing](../CONTRIBUTING.md) and the
  [documentation style guide](STYLE.md).
- [Maintaining](MAINTAINING.md): branching, releases, security baseline, and
  contingency plans.
