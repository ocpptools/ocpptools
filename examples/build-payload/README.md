# Build a payload

Builds an OCPP 2.0.1 `BootNotification` CALL frame with `@ocpptools/builder`,
reading the request schema from `@ocpptools/schemas`.

`buildCall` checks the payload structurally against the schema and returns the
complete `[2, messageId, action, payload]` frame. A failure returns `ok: false`
with a readable error; it does not throw. For full schema validation, pass the
payload to `@ocpptools/validator`.

## Use it in your own project

```sh
npm install @ocpptools/builder @ocpptools/schemas
```

Copy [`index.mjs`](index.mjs) into your project and run `node index.mjs`.

## Run it in this repository

```sh
pnpm build
pnpm --filter @ocpptools-example/build-payload start
pnpm --filter @ocpptools-example/build-payload test
```

See also the [builder README](../../packages/builder/README.md).
