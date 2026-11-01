# @ocpptools/core

## 0.1.0

### Minor Changes

- bdf3519: Add the CALLERROR error codes of OCPP 1.6J and 2.0.1 as separate per-version sets (`OCPP_ERROR_CODES`, `OcppErrorCode`) and the `isErrorCode` check. The 1.6J spelling `OccurenceConstraintViolation` is kept, and 2.0.1 uses `FormatViolation`, `OccurrenceConstraintViolation`, `RpcFrameworkError`, and `MessageTypeNotSupported`.
- 1b01d26: Add OCPP-J frame types (`CallFrame`, `CallResultFrame`, `CallErrorFrame`, `OcppFrame`), the `MESSAGE_TYPE` constants, the `isCall`, `isCallResult`, and `isCallError` guards, JSON value types, and the supported OCPP versions with their WebSocket subprotocol names.
- ad989d1: Add `parseFrame`, which parses an OCPP-J text frame into a typed `OcppFrame` and returns a `Result` instead of throwing. A rejected frame reports a `malformed`, `unknown-message-type`, or `invalid-payload` error, with the message ID when it could be read. Also add the `Result` type.
- 1c857d2: Add the `Transport`, `Clock`, and `Storage` interfaces, with `TransportFactory` and the related types. They let a simulator or client run in a browser, in Node, and under test without depending on a concrete WebSocket, timer, or storage. The package ships no implementations of them.
- 0dc6e4f: Add `serializeFrame`, which turns an `OcppFrame` into compact JSON text and returns a `Result` instead of throwing. It rejects values JSON cannot represent and anything that is not a well-formed frame, so its output always parses back with `parseFrame`. Also add `createMessageIdGenerator` for random UUID message IDs, with the `MessageIdGenerator` and `RandomUuidSource` types for injecting a custom source.
