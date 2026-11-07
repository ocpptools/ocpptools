# @ocpptools/validator

Validation of OCPP-J frames and their payloads for OCPP 1.6J and 2.0.1, against
the OCPP JSON Schemas, with readable errors.

> **Status:** alpha. This package is published with `core` and `schema-utils`
> in the 0.2.0 release. The conventions it follows are
> in [ADR 0005](https://github.com/ocpptools/ocpptools/blob/main/docs/ADR/0005-validator-conventions.md).

It uses Ajv and `ajv-formats`, receives its schemas from a registry you provide,
and compiles each schema lazily. It contains no OCPP schema and no list of
actions. It has no DOM or Node APIs.

## Install

Requires Node.js 22.12 or newer. The package is ESM only.

```bash
npm install @ocpptools/validator
npm install @ocpptools/schemas
```

`@ocpptools/schemas` is optional. Any registry that returns JSON Schemas works.

## Validate a frame

```ts
import { createSchemaRegistry, createValidator } from '@ocpptools/validator';

const schemas = createSchemaRegistry({
  version: '2.0.1',
  files: ['2.0.1/HeartbeatRequest.json'],
  load: async (fileName) => {
    if (fileName !== 'HeartbeatRequest.json') return undefined;
    const module = await import('@ocpptools/schemas/2.0.1/HeartbeatRequest.json', {
      with: { type: 'json' },
    });
    return module.default;
  },
});

const validator = createValidator({ version: '2.0.1', schemas });
const result = await validator.validateFrame([2, 'id-1', 'Heartbeat', {}]);

if (result.status !== 'valid') {
  console.log(result.status, result.issues, result.warnings);
}
```

A string is parsed as JSON text. Any other value is treated as an already parsed
frame:

```ts
await validator.validateFrame('[2,"id-1","Heartbeat",{}]');
await validator.validateFrame([2, 'id-1', 'Heartbeat', {}]);
```

## Validate a payload

If you already know the action and kind, skip the frame:

```ts
const result = await validator.validatePayload('Heartbeat', 'request', {});
```

`validatePayload` returns paths relative to the payload. `validateFrame` returns
paths relative to the frame: `[3, 'idTag']` for a CALL and `[2, 'status']` for a
CALLRESULT.

## CALLRESULT

A CALLRESULT does not name its action. Pass the request action to check its
payload; otherwise the frame is valid with an `unchecked-result` warning:

```ts
await validator.validateFrame([3, 'id-1', { currentTime: '2026-01-01T00:00:00Z' }], {
  requestAction: 'Heartbeat',
});
```

## Results

`status` is one of:

| Status            | Meaning                                                          |
| ----------------- | ---------------------------------------------------------------- |
| `valid`           | The frame is valid and every checked payload matches its schema. |
| `invalid-frame`   | The text is not JSON, or the frame structure is invalid.         |
| `unknown-action`  | The registry has no schema for the action and kind.              |
| `schema-missing`  | The action is known, but its schema could not be loaded or used. |
| `invalid-payload` | The payload does not match the schema.                           |

An issue has `code`, `path`, `pointer`, `message`, and, when applicable,
`keyword`, `expected`, and `received`. Payload issues are sorted by path and
keyword. Warnings do not invalidate the result; a long message ID and an
unchecked CALLRESULT are warnings.

## Bring your own schemas

The package does not need `@ocpptools/schemas`. A registry only has to answer
`get(action, kind)`:

```ts
const schemas = {
  get(action: string, kind: 'request' | 'response') {
    if (action !== 'Heartbeat') return undefined;
    return kind === 'request'
      ? { type: 'object', properties: {}, additionalProperties: false }
      : {
          type: 'object',
          required: ['currentTime'],
          properties: { currentTime: { type: 'string' } },
        };
  },
};
```

Each schema must be self-contained: a `$ref` to another supplied schema by
`$id` is not supported. A real module namespace, which is what `import()`
returns, is rejected; return the schema or its `.default` export.

## Browser and Vite

The package cannot write the schema loader for you: a bundler only splits
imports it can see in your code. In Vite or Astro, use `import.meta.glob` and
build `files` from its keys:

```ts
const modules = import.meta.glob('/node_modules/@ocpptools/schemas/schemas/2.0.1/*.json', {
  import: 'default',
});
const files = Object.keys(modules).map((path) => path.split('/').pop()!);

const schemas = createSchemaRegistry({
  version: '2.0.1',
  files,
  load: (fileName) => modules[`/node_modules/@ocpptools/schemas/schemas/2.0.1/${fileName}`](),
});
```

A template literal such as ``import(`@ocpptools/schemas/2.0.1/${name}.json`)`` is
not split by Vite. Use `import.meta.glob` or a written map of `import()` calls.

## Content Security Policy

Ajv compiles schemas with `new Function`. A CSP without `unsafe-eval` blocks the
validator. Precompiled validators are a future improvement.

## MultipleOf

The validator uses `multipleOfPrecision: 6`, so decimal values such as `0.3`
against `multipleOf: 0.1` are valid. Some browsers and older validators reject
them because of floating point error.

## Limits

- `received` is truncated to 40 characters.
- There is no issue-count limit in 0.2.0.
- A schema must be self-contained; cross-schema `$ref` by `$id` is not supported.
- A schema that uses `__proto__` as a property name is rejected.
- Validation does not coerce types or insert defaults.

## API

- `createValidator({ version, schemas })`
- `Validator.version`, `validateFrame(input, options?)`, `validatePayload(action, kind, payload)`
- `createSchemaRegistry({ version, load, files? })`
- `SchemaRegistry`, `SchemaRegistryOptions`, `SchemaLoadError`
- `schemaFileName(version, action, kind)`
- `ValidationResult`, `ValidationIssue`, `ValidationIssueCode`

## License

Apache-2.0. See the repository `LICENSE` and `NOTICE`.
