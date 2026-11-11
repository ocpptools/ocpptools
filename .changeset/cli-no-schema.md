---
'ocpptools': minor
---

Add `--no-schema` to `ocpptools validate`. It skips the OCA payload schemas but still checks the JSON, the frame shape, and the CALLERROR code for the selected version. This is the contingency path if the schema package must be withdrawn.
