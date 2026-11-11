# Build a payload

Builds an OCPP 2.0.1 `BootNotification` CALL frame with the published builder.

```bash
pnpm build
pnpm --filter @ocpptools-example/build-payload start
pnpm --filter @ocpptools-example/build-payload test
```

`buildCall` validates the payload against the schema and returns the complete
`[2, messageId, action, payload]` frame. A failure returns `ok: false` with a
readable error; it does not throw.
