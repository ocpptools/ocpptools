# @ocpptools/builder

Headless schema-driven OCPP-J payload and frame builder.

[![npm](https://img.shields.io/npm/v/@ocpptools/builder)](https://www.npmjs.com/package/@ocpptools/builder)
[![License](https://img.shields.io/npm/l/@ocpptools/builder)](https://github.com/ocpptools/ocpptools/blob/main/LICENSE)

> **Status:** alpha. The API can change in any minor release before 1.0.0.

The package is a small model over a schema registry that you supply, for OCPP
1.6J and 2.0.1. It does not contain OCPP schemas, action lists, per-action
types, examples, DOM, or Tailwind. It never reads files, the network, or
ambient time.

## When to use it

- You build a form, an inspector, or an editor for OCPP messages and need the
  fields, required values, and defaults of each action.
- You need to create CALL, CALLRESULT, and CALLERROR frames with a structural
  check of the payload.
- For full JSON Schema validation, use
  [`@ocpptools/validator`](https://github.com/ocpptools/ocpptools/tree/main/packages/validator).
  A successful build means structurally plausible, not schema-valid.

## Install

```sh
npm install @ocpptools/builder
```

Requires Node.js 22.12 or newer outside the browser. The package is ESM-only
and also runs in the browser.

## Quick start

The schema below is synthetic. Your application supplies the real schemas, for
example from `@ocpptools/schemas` or its own registry.

```ts
import { createBuilder } from '@ocpptools/builder';

const heater = {
  $schema: 'http://json-schema.org/draft-07/schema#',
  type: 'object',
  required: ['mode'],
  properties: {
    mode: { enum: ['eco', 'boost'], default: 'eco' },
    target: { type: 'number', minimum: 5, maximum: 30 },
    labels: { type: 'array', items: { type: 'string' }, maxItems: 3 },
  },
};

const registry = {
  get: (action: string, kind: 'request' | 'response') =>
    action === 'Example' && kind === 'request' ? heater : undefined,
};

const builder = createBuilder({
  version: '2.0.1',
  schemas: registry,
  messageIds: () => 'msg-1',
});

const payload = await builder.buildPayload('Example', { target: 21 });
// { ok: true, value: { target: 21, mode: 'eco' }, warnings: [] }

const call = await builder.buildCall('Example', { target: 21 });
// { ok: true, value: [2, 'msg-1', 'Example', { target: 21, mode: 'eco' }], warnings: [] }

const text = builder.serialize(call.value);
// { ok: true, value: '[2,"msg-1","Example",{"target":21,"mode":"eco"}]', warnings: [] }
```

The registry may return a schema or a promise. It may also expose `actions()`;
the builder never invents an action list. You can pass `actions` in the options
instead. The
[build-payload example](https://github.com/ocpptools/ocpptools/tree/main/examples/build-payload)
loads the official schemas from `@ocpptools/schemas`.

## What it does

1. Normalizes draft-04, draft-06, or draft-07 schemas to draft-07.
2. Resolves local `$ref` values with limits.
3. Describes the schema as a `Field` tree for a form or an inspector.
4. Creates the required empty payload and applies defaults.
5. Checks a payload structurally.
6. Builds CALL, CALLRESULT, and CALLERROR frames.
7. Serializes with `@ocpptools/core`.

It does **not** validate JSON Schema completely. Compositions
(`allOf`, `anyOf`, `oneOf`), `additionalProperties`, `pattern`, `format`,
`dependencies`, `patternProperties`, `if`/`then`/`else`, and other unlisted
keywords are not enforced. See [Limits](#limits) for what the structural check
covers.

## Describe fields

```ts
const fields = await builder.fields('Example', {
  omit: (path) => path[path.length - 1] === 'customData',
});
```

`fields()` returns a `Field` tree from `@ocpptools/schema-utils`. Paths are
arrays of property names and array indexes, never dotted strings. A field that
uses an unsupported composition arrives as `kind: 'unsupported'` with a reason;
the builder does not guess.

`emptyPayload()` returns the required skeleton. A required leaf with no
`default` and no `enum` is left out, so the empty payload can still fail
`buildPayload()`; that is intentional.

## Validate fully

The builder and the validator accept the same structural registry shape
(`{ get(action, kind) }`), so you can pass a built payload to the validator:

```ts
import { createValidator } from '@ocpptools/validator';

// `registry` and `payload` come from the quick start above.
const validator = createValidator({ version: '2.0.1', schemas: registry });
const result = await validator.validatePayload('Example', 'request', payload.value);
```

They are independent packages; the builder does not import Ajv or the OCA
schemas.

## API

```ts
createBuilder({ version, schemas, actions?, messageIds?, examples?, schemaLimits?, payloadLimits? })
```

- `has(action, kind?)`
- `listActions()`
- `fields(action, { kind?, omit? })`
- `emptyPayload(action, { kind?, fill? })`
- `buildPayload(action, value, { kind?, applyDefaults? })`
- `buildCall(action, value, { messageId? })`
- `buildResult(action, value, messageId)`
- `buildError(messageId, code, description, details?)`
- `serialize(frame)`
- `example(action)`

Every schema/payload operation returns a result:

```ts
type BuilderResult<T> =
  | { ok: true; value: T; warnings: readonly BuilderWarning[] }
  | { ok: false; error: BuilderIssue; warnings: readonly BuilderWarning[] };
```

`BuilderIssue` has `source`, `code`, `path`, `message`, `expected`, and
`received`. `received` is truncated to 40 characters. The design is recorded in
[ADR 0013](https://github.com/ocpptools/ocpptools/blob/main/docs/ADR/0013-builder-api.md).

## Limits

- Schema resolution defaults to depth 128 and 100 000 nodes.
- Payload checking defaults to depth 64 and 10 000 nodes.
- `pattern` and `format` are not evaluated, which avoids ReDoS from
  caller-supplied schemas.
- `additionalProperties` is not checked; `uniqueItems` is checked.
- Enum comparison is JSON value equality, not stringification.
- String lengths count Unicode code points.
- Non-JSON values (`undefined`, functions, symbols, BigInt, `NaN`, `Infinity`,
  cycles, `Date`, `Map`, class instances) are rejected.
- Key material is the caller's responsibility; the builder stores no secrets.

## Related packages

- [`@ocpptools/validator`](https://github.com/ocpptools/ocpptools/tree/main/packages/validator):
  full schema validation with the same registry shape.
- [`@ocpptools/schema-utils`](https://github.com/ocpptools/ocpptools/tree/main/packages/schema-utils):
  the normalization and field metadata the builder uses.
- [`@ocpptools/schemas`](https://github.com/ocpptools/ocpptools/tree/main/packages/schemas):
  the official OCPP JSON Schemas, unmodified.

## License

Apache-2.0. See the repository `LICENSE` and `NOTICE`.

The package ships no OCA schema, action list, per-action type, or example. It
only transforms a schema that the caller supplies in memory. The Open Charge
Alliance's schemas are available separately in `@ocpptools/schemas` under
CC BY-ND 4.0.

OCPP is a specification of the Open Charge Alliance. This project is not
affiliated with, endorsed by, or certified by the Open Charge Alliance.
