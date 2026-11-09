# 0007. Simulator Node adapter

- Status: accepted
- Date: 2026-11-09

## Context

ADR 0006 deferred the Node adapter and said it would arrive with the CLI. The
package now needs a Node transport, clock, and storage before the CLI can be
built, and users running the engine in Node need those pieces without a
dependency on a third-party WebSocket library. Node 22.12 provides a global
`WebSocket` implementation, which is the baseline the package already requires.

The engine and the browser adapter must stay free of Node APIs, and the package
must keep `@ocpptools/core` as its only runtime dependency.

## Decision

1. **Entrypoint.** `@ocpptools/simulator/node` exports
   `createNodeWebSocketTransportFactory`, `nodeClock`, `createMemoryStorage`,
   and `createFileStorage`, plus the structural WebSocket types. It contains no
   protocol profile and is separate from the engine and browser entries.

2. **WebSocket transport.** The default factory uses the Node 22 built-in
   `WebSocket` through structural `NodeWebSocketLike` and
   `NodeWebSocketConstructor` types, so `typeof WebSocket` never appears in the
   declaration files and a caller can inject another compatible constructor.
   The transport has the same one-use lifecycle as the browser adapter. It
   preserves an explicit `wasClean`, otherwise treats code `1000` as clean, and
   synthesizes a `1006` close when Node 22 emits `error` without a later
   `close` during connection or shutdown. It sets `binaryType` to
   `arraybuffer` when available, accepts text, `ArrayBuffer`, `Buffer`,
   `Buffer[]`, and `Uint8Array` message data, and throws when `WebSocket` is not
   available. `ws` and `@types/ws` are development dependencies used by tests
   only; they are not runtime, peer, or optional dependencies.

3. **Clock and storage.** `nodeClock` uses `node:timers` and `Date.now`.
   `createMemoryStorage` wraps a `Map`. `createFileStorage` stores one file per
   key, hashes the key with SHA-256 so it cannot escape the directory, creates
   the directory with mode `0700`, writes a unique `randomUUID` temporary file
   with flag `wx` and mode `0600`, and renames it over the target. Renames and
   deletes retry `EPERM`, `EBUSY`, and `EACCES` five times with bounded backoff
   from `node:timers/promises`; the temporary file is removed on failure, the
   old target survives, and missing files read as `undefined` and delete
   successfully. The directory mode applies only when the directory is created;
   POSIX modes are not enforced on Windows.

4. **Build separation.** A dedicated `tsconfig.node.json` builds `src/node` to
   `dist/node` with Node types. The engine build excludes `src/node`, the
   browser build is unchanged, and the checks reject Node built-ins in engine
   modules and cross-imports between the engine, browser, and Node entries.

5. **Phase placement.** The Node adapter is the first piece of Phase 7. It
   lands before `@ocpptools/kit` and the `ocpptools` CLI because the CLI
   consumes it; the CLI remains the last package to be published. The portable
   constructor only sets the URL and subprotocol. Custom headers and mutual TLS
   require an injected constructor and are documented as a limitation.

## Consequences

- Node users get a working transport, clock, and persistence without adding a
  runtime WebSocket dependency.
- File storage is atomic within one process, but the retry policy does not make
  concurrent writers across processes safe; callers still own their storage
  policy and credentials.
- The built-in `WebSocket` keeps the runtime small but cannot configure custom
  headers or mutual TLS through the portable constructor.
- The Node adapter, engine, and browser adapter remain independently loadable
  and can be replaced without touching protocol logic.
