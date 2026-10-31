# @ocpptools/core

OCPP-J frame types, a strict parser and serializer, per-version error codes,
and the transport, clock, and storage interfaces for OCPP 1.6J and 2.0.1.

> **Status:** pre-alpha. Nothing is published yet and the API can still change
> before 0.1.0.

It has no runtime dependencies. It does not use the DOM or Node APIs, and it
does not include OCPP JSON Schemas or validate payloads against them.

## Install

Requires Node.js 22.12 or newer. The package is ESM only.

```bash
npm install @ocpptools/core
```

## Parse a frame

`parseFrame` takes one text frame and returns a result. It never throws.

```ts
import { isCall, parseFrame } from '@ocpptools/core';

const result = parseFrame('[2,"19223201","BootNotification",{"chargePointVendor":"Acme"}]');

if (!result.ok) {
  // kind is 'malformed', 'unknown-message-type', or 'invalid-payload'.
  console.error(result.error.kind, result.error.message);
} else if (isCall(result.value)) {
  const [, messageId, action, payload] = result.value;
  console.log(messageId, action, payload);
}
```

Parsing is strict and structural. It checks the array shape, the element count
for each message type, that the message ID and action are non-empty strings,
and that payloads are JSON objects. It does not check a payload against an
action's schema.

When a frame is rejected but its message ID could be read, `error.messageId` is
set, so you can answer with a CALLERROR.

## Serialize a frame

`serializeFrame` returns compact JSON text, or a result describing why the frame
cannot be sent.

```ts
import { serializeFrame } from '@ocpptools/core';

const result = serializeFrame([3, '19223201', { status: 'Accepted' }]);

if (result.ok) {
  socket.send(result.value); // [3,"19223201",{"status":"Accepted"}]
}
```

Array order and object key order are preserved. Values JSON cannot represent
(`undefined`, functions, symbols, BigInt, `NaN`, `Infinity`, circular
references) are rejected instead of being changed or dropped, so the output
always parses back with `parseFrame`.

## Message IDs

```ts
import { MESSAGE_TYPE, createMessageIdGenerator, serializeFrame } from '@ocpptools/core';

const nextId = createMessageIdGenerator();
const result = serializeFrame([MESSAGE_TYPE.CALL, nextId(), 'Heartbeat', {}]);
```

IDs are random UUIDs of 36 characters, the maximum length of an OCPP message
ID. By default the generator uses `globalThis.crypto.randomUUID()`. A
`MessageIdGenerator` is just `() => string`, so you can pass your own in
environments without it, or in tests that need predictable IDs.

## Error codes differ between versions

The CALLERROR error codes of 1.6J and 2.0.1 are separate sets. They are not
merged, because the spelling and the content changed:

| 1.6J                           | 2.0.1                           |
| ------------------------------ | ------------------------------- |
| `FormationViolation`           | `FormatViolation`               |
| `OccurenceConstraintViolation` | `OccurrenceConstraintViolation` |
| (not defined)                  | `MessageTypeNotSupported`       |
| (not defined)                  | `RpcFrameworkError`             |

The 1.6J spelling `OccurenceConstraintViolation` (one `r`) is part of that
version of the protocol, so it is kept as is.

```ts
import { OCPP_ERROR_CODES, isErrorCode } from '@ocpptools/core';

isErrorCode('1.6', 'FormationViolation'); // true
isErrorCode('2.0.1', 'FormationViolation'); // false
OCPP_ERROR_CODES['2.0.1']; // every 2.0.1 code
```

`parseFrame` accepts any error code in a CALLERROR, because a peer can send a
code outside the specified set. Use `isErrorCode` to check it.

## Transport, Clock, and Storage

These are interfaces only. This package ships no implementations.

- `Transport` is one text connection (usually a WebSocket) with `connecting`,
  `open`, `closing`, and `closed` states. A `TransportFactory` creates one for
  a URL and an OCPP subprotocol (`OCPP_SUBPROTOCOLS`).
- `Clock` provides `now`, `setTimeout`, and `clearTimeout`.
- `Storage` is asynchronous key-value storage for text values. It is not the
  synchronous DOM `Storage`.

Code written against them runs in a browser, in Node, and under test.

## API stability

Before 1.0.0, minor releases can contain breaking changes. They are listed in
the changelog.

## License

Apache-2.0. See the repository `LICENSE` and `NOTICE`.
