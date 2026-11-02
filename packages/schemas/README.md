# @ocpptools/schemas

The OCPP 1.6J and OCPP 2.0.1 JSON Schemas, exactly as the Open Charge Alliance
published them.

> **Status:** alpha. The Open Charge Alliance has not confirmed in writing that
> the JSON files are covered by CC BY-ND 4.0. The maintainers publish them
> unmodified, with the license and attribution, and accept that risk. See
> [ADR 0003](https://github.com/ocpptools/ocpptools/blob/main/docs/ADR/0003-oca-json-schemas.md).

## Author and source

**These schemas are not our work.** They are written and published by the
**[Open Charge Alliance](https://openchargealliance.org/)** (OCA), which holds
the copyright. They come from the official downloads on the OCA website:

| OCPP version | Files                 | Official package                                             |
| ------------ | --------------------- | ------------------------------------------------------------ |
| 1.6J         | 56 (`schemas/1.6`)    | `OCPP_1.6_documentation.zip`, folder `schemas/json`          |
| 2.0.1        | 128 (`schemas/2.0.1`) | `OCPP-2.0.1_all_files.zip` (Edition 4), `part3_JSON_schemas` |

Download them from the OCA: <https://openchargealliance.org/download-ocpp/>.
Exact URLs, dates, and hashes of the packages are in [SOURCES.md](SOURCES.md).

Copyright © Open Charge Alliance. All rights reserved, except as licensed
below. The copyright notices of the documents published in the same packages are
quoted in [SOURCES.md](SOURCES.md).

## License

The schema files are made available by the Open Charge Alliance under the
**[Creative Commons Attribution-NoDerivatives 4.0 International Public License](https://creativecommons.org/licenses/by-nd/4.0/legalcode)**
(CC BY-ND 4.0). The full text is in
[LICENSE-CC-BY-ND-4.0.txt](LICENSE-CC-BY-ND-4.0.txt) and ships with this
package.

- **The files are not modified.** Every file in `schemas/` is a byte-for-byte
  copy of the original, with the original line endings. Nothing was formatted,
  re-encoded, normalized, or renamed.
- **Do not change them and then share them.** CC BY-ND does not allow sharing
  modified copies. Changing them for your own use is allowed.
- **Keep this notice** when you redistribute the files: the creator, the
  copyright notice, the license, and a link to the source.
- The rest of this package (this README, `SOURCES.md`, `manifest.json`, and
  `package.json`) is licensed under Apache-2.0, like the rest of OCPP Tools. That
  is why the package license is `Apache-2.0 AND CC-BY-ND-4.0`. The Apache
  License does not apply to the schema files.

The OCA did not publish a separate license notice inside the JSON files. They
are distributed in the same packages as the OCA specification documents, all of
which state CC BY-ND 4.0, and this package treats them the same way. See
[ADR 0003](https://github.com/ocpptools/ocpptools/blob/main/docs/ADR/0003-oca-json-schemas.md).

## Not affiliated with the OCA

OCPP is a trademark of the Open Charge Alliance. OCPP Tools is an independent
open-source project. It is not affiliated with, endorsed by, sponsored by, or
certified by the Open Charge Alliance, and including these files does not imply
otherwise.

## Contents

```text
schemas/1.6/<Action>.json            requests
schemas/1.6/<Action>Response.json    responses
schemas/2.0.1/<Action>Request.json
schemas/2.0.1/<Action>Response.json
manifest.json                        SHA-256 of every file, and where it came from
SOURCES.md                           editions, URLs, hashes, copyright notices
LICENSE-CC-BY-ND-4.0.txt             the license text
```

The schemas use their original JSON Schema drafts: draft-04 for 1.6J and
draft-06 for 2.0.1. Use `@ocpptools/schema-utils` to read them in a uniform way.
It converts them in memory, inside your own process.

With Node.js you can import a file by its path:

```js
import authorize from '@ocpptools/schemas/2.0.1/AuthorizeRequest.json' with { type: 'json' };
```

## Verify that nothing changed

`manifest.json` lists the SHA-256 of every file. In the repository,
`pnpm lint:schemas` fails if a file differs from it, is missing, or is not
listed. You can also compare a file with the one in the official OCA package.
