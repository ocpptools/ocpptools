---
'@ocpptools/schema-utils': patch
---

Strip keywords introduced after the input draft when `stripUnknownKeywords` is set. A draft-06 schema now drops `if`/`then`/`else`, `$comment`, `readOnly`, `writeOnly`, and the content keywords, and a draft-04 schema also drops `const`, `contains`, `examples`, and `propertyNames`. This makes normalization conformant for Ajv instead of enforcing draft-07 keywords that the source draft ignores.
