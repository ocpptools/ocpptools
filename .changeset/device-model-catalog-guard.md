---
'@ocpptools/simulator': patch
---

Make the curated 2.0.1 device-model catalog explicit and enforceable. The four
hand-written variables are frozen in code, and `GetVariables`, `SetVariables`,
monitoring, reports, and `deviceModel.variables()` ignore variables added
outside it. A test fails if the simulator source statically imports OCA schemas,
ships a JSON catalog, or the catalog changes without an explicit update.
