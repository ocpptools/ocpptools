---
'@ocpptools/simulator': minor
---

Add an opt-in ISO 15118/EXI codec to the 2.0.1 security integration.
`certificates.get15118Message` encodes the request, requires an accepted
`Get15118EVCertificate` response, validates the EXI length, decodes it, and
optionally runs the codec's response validator. No EXI implementation is
bundled, and the engine still makes no network requests. The exported
`Iso15118Codec201` now uses input objects (`{ schemaVersion, action, payload }`,
`{ schemaVersion, action, exiResponse }`, and `{ schemaVersion, action, response }`)
instead of positional arguments. Raw 15118 requests are length-checked and
reject private-key material.
