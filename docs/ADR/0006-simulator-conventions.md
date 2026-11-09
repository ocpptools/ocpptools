# 0006. Simulator conventions

- Status: accepted; the Node-adapter clause and entrypoint list in point 1, and the build sentence in point 9, are superseded by [0007](0007-simulator-node-adapter.md)
- Date: 2026-11-07

## Context

`@ocpptools/simulator` is a headless charge point simulator for OCPP 1.6J and
2.0.1. It replaces protocol code that is currently mixed with browser UI, and
it must work in a browser, in Node, and under a deterministic test clock without
carrying the DOM into its engine.

`@ocpptools/core` already provides the pieces that must not be duplicated: the
one-use `Transport` and its `TransportFactory`, `Clock`, `Storage`, frame
parsing and serialization, message IDs, and per-version error codes. The
simulator adds the protocol conversation on top of them.

ADR 0004 forbids packages that ship per-action payload types or action lists
derived from the Open Charge Alliance (OCA) schemas. The simulator is
behavior-driven: it implements the actions it understands in code and does not
learn them from a schema registry. That difference needs an explicit
supersession of ADR 0004 point 5 for this package, not a new schema
dependency.

## Decision

1. **Headless boundary and entrypoints.** The engine has no DOM or Node APIs.
   The browser adapter lives only in `@ocpptools/simulator/browser`; the Node
   adapter is deferred. The package exposes `.`, `./1.6`, `./2.0.1`, and
   `./browser`. The root entry accepts `version`; the version subpaths fix it.
   The browser subpath exports adapters, not protocol profiles.

2. **Injected environment.** `createSimulator` requires a `TransportFactory`
   and a `Clock`. `Storage`, `random`, and `MessageIdGenerator` are optional
   injections. The engine creates intervals with recursive `Clock.setTimeout`
   because `Clock` has no `setInterval`. Outside the dedicated default-random
   module and the browser adapters, the engine does not read ambient time,
   `Math.random`, `setTimeout`, `WebSocket`, or storage. Public boundaries use
   `unknown`, not `any`.

3. **Transport lifecycle and reconnection.** A `Transport` is never reused. The
   engine creates a new one with the factory for every attempt. Reconnection,
   backoff, the offline queue, and pending-call cancellation belong to the
   engine, not the adapter. The default connect timeout is 15 seconds, the
   backoff starts at 1 second, doubles, and caps at 30 seconds, and the default
   maximum is 5 attempts. A manual `connect()` resets the attempt count; a
   manual `disconnect()` suppresses reconnection.

4. **Protocol coverage.** The simulator targets all 28 OCPP 1.6J actions and all
   64 OCPP 2.0.1 actions. Coverage has three tiers: stateful core behavior,
   deeper simulated behavior, and standard-status behavior for features that
   cannot be exercised without hardware. No action is left unhandled. Every
   action has at least one schema-valid success test and one error test.
   Internal handlers and flow methods are behavior, not a schema-derived action
   list or catalog. This supersedes point 5 of ADR 0004 for the simulator: the
   package is behavior-driven, not schema-driven. The maintainers record that
   the hand-written payload construction and device-model structures are
   original behavior code, not generated or copied schema artifacts, and that
   no schema-derived action, field, or device-model catalog is shipped. If the
   OCA objects, the affected features are reduced.

5. **Boot, ready, and queue.** `ready` means the transport is open and, when
   boot is required, `BootNotification` was accepted. Only CALL frames enter
   the offline queue. The queue is FIFO, bounded, persisted when `Storage` is
   injected, and replayed with at-least-once semantics for retained entries;
   overflow entries are dropped and duplicate delivery is possible and
   documented. BootNotification and Heartbeat are never queued.
   Periodic meter values are skipped while offline. The default flush point is
   **ready**: after boot is accepted when boot is required, or on open when it
   is not. `flushOn: 'open'` is a lab-only override and is rejected when boot is
   required. `Pending` boot responses retry; `Rejected` responses do not start
   heartbeat or status loops. Active transactions survive reconnect, and the
   profile reconciles status and meter loops after the next **ready transition**
   (accepted boot when boot is required, on open when it is not). When boot is
   not required, `clockOffsetMs` stays zero until a response carries a usable
   `currentTime`.

6. **State, events, and persistence.** State is JSON-serializable: no
   functions, timers, transports, or class instances. `getState()` returns a
   copy. Events are a discriminated union with a numeric timestamp. The queue
   and persisted settings have one source of truth in the snapshot, not two.
   Snapshots are versioned, validated as hostile input, and exclude in-flight
   pending calls and metrics. The offline queue has a bounded size and drops the
   oldest entry on overflow. `clockOffsetMs` is reset on restore and recomputed
   from the next boot or usable `currentTime`. URLs stored in a snapshot may
   contain credentials, and the caller owns the storage.

7. **Errors and inbound calls.** Package errors and OCPP wire errors are
   separate. `SimulatorError` codes describe local failures; CALLERROR codes
   come from the version-specific sets of `core` and are never merged.
   `sendCallError` validates the code against the simulator version. Unknown
   incoming CALLERROR codes are accepted with a warning: the simulator parses
   the frame structurally and does not turn that case into an `inspectFrame`
   error. A pending CALL settles exactly once, by result, CALLERROR, timeout,
   disconnect, send failure, or dispose. An inbound handler is synchronous or
   asynchronous and replies exactly once; a second reply is ignored and
   reported. Unknown actions reply `NotImplemented`, malformed frames reply
   `FormationViolation` or `FormatViolation` when a message ID is available, and
   a handler exception replies `InternalError`. Inbound payloads are not
   schema-validated by default.

8. **Validation, faults, and scenarios.** Outbound payload validation is an
   injected callback, so the package does not depend on `validator`, Ajv, or
   the OCA schemas at runtime. Fault injection is off by default and uses the
   injected random source; latency is applied before the pending timeout starts
   and delayed sends are cancelled when the call settles. The scenario runner
   uses version-neutral steps plus profile conveniences; waits use `Clock`.
   Lab features are for exercising a CSMS, not for production or conformance.

9. **Build, dependencies, and release.** The main build uses `ES2022` without
   DOM; the browser build uses the DOM library. `@ocpptools/core` is the only
   runtime dependency, with the 0.x range declared explicitly. The simulator
   stays outside the fixed Changesets group and starts at `0.1.0`. It remains
   private until its first release and is published only through CI with
   provenance. The independent versioning is a deliberate choice for this
   package; future releases follow Changesets normally.

10. **Legal boundary and verification.** The simulator is an original,
    behavior-driven implementation. It does not copy schema text, descriptions,
    comments, or generated artifacts, and it does not ship a schema-derived
    action, field, or device-model catalog. Tests may load `@ocpptools/schemas`
    at runtime as data, but generated payload fixtures are not committed.
    Certificate chains, security events, firmware, and logs are simulated
    records; they are not real cryptography, firmware flashing, or conformance
    evidence. The package README and NOTICE carry the OCA attribution and
    non-affiliation notice. A mock CSMS and a deterministic clock are the
    integration gate; there is no Puppeteer parity harness. No AI attribution
    appears in the ADR, code, comments, changesets, or commits.

## Consequences

- The engine is portable across browsers, Node, and tests, and the browser
  adapter can be replaced without touching protocol logic.
- Consumers must inject time, transport, and, when they want persistence,
  storage. The package does not pick a browser or Node implementation.
- The simulator can cover the complete protocol without shipping schema-derived
  artifacts, but the legal reading of hand-written payloads and device-model
  structures remains a recorded risk.
- The single first release means downstream consumers wait for the complete
  package; the implementation stages are internal only.
- Simulated certificates, firmware, and security features must not be presented
  as real or as conformance evidence.
