# @ocpptools/builder

Headless, schema-driven construction of OCPP-J payloads and frames for OCPP
1.6J and 2.0.1.

> **Status:** alpha. The API can change in any minor release before 1.0.0.

The package is a small model over a schema registry that you supply. It does
not contain OCPP schemas, action lists, per-action types, examples, DOM, or
Tailwind. It never reads files, the network, or ambient time.

OCPP is a specification of the Open Charge Alliance. This project is not
affiliated with, endorsed by, or certified by the Open Charge Alliance.

## Install

```bash
npm install @ocpptools/builder
```

Requires Node.js 22.12 or newer. The package is ESM only and also runs in the
browser.

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
keywords are not enforced. A successful build means structurally plausible, not
schema-valid or conformant. Use `@ocpptools/validator` for full validation.

## Build a payload and a frame

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

const builder = createBuilder({
  version: '2.0.1',
  schemas: {
    get: (action, kind) => (action === 'Example' && kind === 'request' ? heater : undefined),
  },
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
instead.

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

```ts
import { createSchemaRegistry, createValidator } from '@ocpptools/validator';

const schemas = createSchemaRegistry({
  version: '2.0.1',
  files: ['2.0.1/HeartbeatRequest.json'],
  load: async (fileName) => {
    const module = await import(`@ocpptools/schemas/2.0.1/${fileName}`, {
      with: { type: 'json' },
    });
    return module.default;
  },
});

const validator = createValidator({ version: '2.0.1', schemas });
const result = await validator.validatePayload('Heartbeat', 'request', payload.value);
```

The builder and the validator accept the same structural registry shape
(`{ get(action, kind) }`). They are independent packages; the builder does not
import Ajv or the OCA schemas.

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
`received`. `received` is truncated to 40 characters.

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

## Legal

The package ships no OCA schema, action list, per-action type, or example. It
only transforms a schema that the caller supplies in memory. The Open Charge
Alliance's schemas are available separately in `@ocpptools/schemas` under
CC BY-ND 4.0.

## License

Apache-2.0. See the repository `LICENSE` and `NOTICE`.
