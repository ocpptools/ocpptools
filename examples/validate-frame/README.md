# Validate a frame

Validates an OCPP 2.0.1 `BootNotification` frame with the published validator
and the official schemas.

```bash
pnpm build
pnpm --filter @ocpptools-example/validate-frame start
pnpm --filter @ocpptools-example/validate-frame test
```

The example loads the schemas from `@ocpptools/schemas` at runtime. It does not
copy them into the repository.
