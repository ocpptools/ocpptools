---
'@ocpptools/core': minor
---

Add the CALLERROR error codes of OCPP 1.6J and 2.0.1 as separate per-version sets (`OCPP_ERROR_CODES`, `OcppErrorCode`) and the `isErrorCode` check. The 1.6J spelling `OccurenceConstraintViolation` is kept, and 2.0.1 uses `FormatViolation`, `OccurrenceConstraintViolation`, `RpcFrameworkError`, and `MessageTypeNotSupported`.
