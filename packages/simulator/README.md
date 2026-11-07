# @ocpptools/simulator

Headless OCPP 1.6J and 2.0.1 charge point simulator with injectable transports,
clock, and storage.

> **Status:** private alpha. The package is being built and is not published
> yet. The conventions it follows are in
> [ADR 0006](https://github.com/ocpptools/ocpptools/blob/main/docs/ADR/0006-simulator-conventions.md).

The engine has no DOM and no Node APIs. The browser transport lives in
`@ocpptools/simulator/browser`. It contains no OCPP schemas and no per-action
payload types.

OCPP is a specification of the Open Charge Alliance. This project is not
affiliated with, endorsed by, or certified by the Open Charge Alliance.

## License

Apache-2.0. See the repository `LICENSE` and `NOTICE`.
