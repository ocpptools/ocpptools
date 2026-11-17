# Getting started

This tutorial takes about ten minutes. You will:

1. Validate an OCPP frame from the command line.
2. Validate the same frame from your own code.
3. Run a simulated OCPP 1.6J charging station against a mock CSMS, without a
   network.

You need Node.js 22.12 or newer. Every package is ESM-only, so the samples use
`.mjs` files.

The shell commands are for a POSIX shell such as bash or zsh (on Windows, Git
Bash or WSL). In Windows PowerShell, `echo` writes a byte order mark that the
CLI rejects as invalid JSON; create the JSON files with an editor instead.

## 1. Validate a frame from the command line

Create a file with an OCPP 2.0.1 `BootNotification` CALL that is missing a
required field:

```sh
mkdir ocpp-start
cd ocpp-start
echo '[2,"msg-1","BootNotification",{"chargingStation":{"model":"AC-7"},"reason":"PowerUp"}]' > boot.json
```

Validate it with the `ocpptools` CLI. `npx` asks to download it on the first
run, which can take a moment because the CLI includes the OCPP JSON Schemas:

```sh
npx ocpptools validate boot.json --version 2.0.1
```

```text
Invalid: boot.json (invalid-payload)
  /3/chargingStation/vendorName [schema-violation] The property "vendorName" is required
```

Each issue line shows the JSON Pointer of the problem, a code, and a message.
The command exits with `1`. Add the missing field and run it again:

```sh
echo '[2,"msg-1","BootNotification",{"chargingStation":{"model":"AC-7","vendorName":"Acme"},"reason":"PowerUp"}]' > boot.json
npx ocpptools validate boot.json --version 2.0.1
```

```text
Valid: boot.json (valid)
```

The exit code is now `0`. Add `--json` to get the full result as JSON.

## 2. Validate from code

Install the validator and the official schemas:

```sh
npm init -y
npm install @ocpptools/validator @ocpptools/schemas
```

Create `validate.mjs`. The validator does not bundle schemas: you give it a
registry that loads them. In Node, read them from the `@ocpptools/schemas`
package:

```js
import { readFile, readdir } from 'node:fs/promises';
import { createRequire } from 'node:module';
import { dirname, join } from 'node:path';

import { createSchemaRegistry, createValidator } from '@ocpptools/validator';

const require = createRequire(import.meta.url);
const root = join(dirname(require.resolve('@ocpptools/schemas/package.json')), 'schemas', '2.0.1');

const schemas = createSchemaRegistry({
  version: '2.0.1',
  files: await readdir(root),
  load: async (file) => JSON.parse(await readFile(join(root, file), 'utf8')),
});
const validator = createValidator({ version: '2.0.1', schemas });

const frame = await readFile('boot.json', 'utf8');
const result = await validator.validateFrame(frame);

console.log(result.status);
for (const issue of result.issues) {
  console.log(issue.pointer, issue.code, issue.message);
}
```

```sh
node validate.mjs
```

```text
valid
```

Schemas are compiled lazily, the first time an action is validated. `status` is
one of `valid`, `invalid-frame`, `unknown-action`, `schema-missing`, or
`invalid-payload`. The [validator README](../packages/validator/README.md)
explains each status, CALLRESULT validation, and custom registries.

## 3. Simulate a charging station

The simulator is a headless OCPP charging station. Here it talks to a mock CSMS
from `@ocpptools/testing` over an in-memory transport, so no socket is opened
and the run is deterministic.

```sh
npm install @ocpptools/simulator @ocpptools/testing
```

Create `simulate.mjs`:

```js
import { createSimulator16 } from '@ocpptools/simulator/1.6';
import {
  createFakeClock,
  createInMemoryTransportPair,
  createMockCsms,
  flushMicrotasks,
} from '@ocpptools/testing';

const clock = createFakeClock();
const pair = createInMemoryTransportPair();

// The mock CSMS answers only the actions you give it a handler for.
const csms = createMockCsms({
  version: '1.6',
  transport: pair.server,
  handlers: {
    BootNotification: () => ({
      status: 'Accepted',
      currentTime: '2026-01-01T00:00:00Z',
      interval: 60,
    }),
    StatusNotification: () => ({}),
    Authorize: () => ({ idTagInfo: { status: 'Accepted' } }),
    StartTransaction: () => ({ transactionId: 1, idTagInfo: { status: 'Accepted' } }),
    MeterValues: () => ({}),
    StopTransaction: () => ({ idTagInfo: { status: 'Accepted' } }),
  },
});

const simulator = createSimulator16({
  url: 'ws://in-memory/CP-1',
  transport: () => pair.client,
  clock,
  station: {
    id: 'CP-1',
    vendor: 'Acme',
    model: 'AC-7',
    firmwareVersion: '1.0.0',
    connectorCount: 1,
    defaultIdTag: 'AABBCCDD',
  },
});

simulator.connect();
pair.link.open();
for (let attempt = 0; attempt < 20 && !simulator.isReady; attempt += 1) {
  await flushMicrotasks(5);
}

await simulator.authorize('AABBCCDD');
await simulator.startChargingSession(1, 'AABBCCDD');
await simulator.sendMeterValues(1);
await simulator.stopTransaction(1);
await csms.waitForIdle();

console.log(csms.calls.map((call) => call[2]));
simulator.dispose();
```

```sh
node simulate.mjs
```

The output is an array with every action the CSMS received, in order:
`BootNotification`, `StatusNotification`, `Authorize`, `StatusNotification`,
`StatusNotification`, `Authorize`, `StartTransaction`, `StatusNotification`,
`MeterValues`, `StatusNotification`, `StopTransaction`, and `StatusNotification`.

The station reports each connector status change with `StatusNotification`, and
`startChargingSession` authorizes the token again before it starts the
transaction.

To connect to a real CSMS instead, replace the in-memory transport with
`createNodeWebSocketTransportFactory()` and the fake clock with `nodeClock`,
both from `@ocpptools/simulator/node`, and set `url` to your CSMS endpoint. See
[Run a simulated charge point against your CSMS](guides/simulate-against-a-csms.md).

## Next steps

- [Validate OCPP frames in CI](guides/validate-in-ci.md).
- [Unit-test OCPP code without a network](guides/test-without-a-network.md).
- Browse the [runnable examples](EXAMPLES.md) and the
  [package READMEs](README.md#reference).
