# Validate a frame

Validates an OCPP 2.0.1 `BootNotification` frame with `@ocpptools/validator`
and the official schemas from `@ocpptools/schemas`. It prints the result for a
valid frame and for one that is missing a required field.

## Use it in your own project

```sh
npm install @ocpptools/validator @ocpptools/schemas
```

Copy [`index.mjs`](index.mjs) into your project and run `node index.mjs`. The
example loads the schemas from `@ocpptools/schemas` at runtime. It does not
copy them into your project.

## Run it in this repository

```sh
pnpm build
pnpm --filter @ocpptools-example/validate-frame start
pnpm --filter @ocpptools-example/validate-frame test
```

See also the [validator README](../../packages/validator/README.md).
