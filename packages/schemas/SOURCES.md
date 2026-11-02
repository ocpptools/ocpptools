# Sources of the schemas

Every file in `schemas/` is an unmodified copy of a file published by the Open
Charge Alliance (OCA). This page says where each set came from. The SHA-256 of
every file is in [manifest.json](manifest.json).

## OCPP 1.6J — `schemas/1.6`

- **Author and copyright holder:** Open Charge Alliance.
- **Official package:** `OCPP_1.6_documentation.zip`, the folder
  `OCPP_1.6_documentation/schemas/json/` (56 files). The package also holds the
  SOAP schemas and the specification documents, which are not included here.
- **Downloaded from:**
  <https://openchargealliance.org/download/7b06ab293c68fb6b4f4ae0960e502579c1c5516aa2b7acf0fdcedba585b9ea7f/>
  (it redirects to `wp-content/uploads/2025/04/OCPP_1.6_documentation.zip`) on
  2026-11-01.
- **SHA-256 of the package:**
  `2a1d80284ca60449e85951fc55bc0538b5d45bd6f97c6d9228745acacb52c11b`
- **Version stamps inside the files:** 55 files carry December 2019 (2019-12).
  `StopTransaction.json` carries April 2025 (2025-04): the OCA updated it in the
  2025-04 errata release. All are written in JSON Schema draft-04.
- **License:** CC BY-ND 4.0. The documents in this package state it. For
  example, the 1.6 specification (edition 2) says: "Copyright © 2010 – 2017 Open
  Charge Alliance. All rights reserved." and "This document is made available
  under the Creative Commons Attribution-NoDerivatives 4.0 International Public
  License". The two SOAP service descriptions (`.wsdl`) in the same folder carry
  the same notice in their headers.
- The JSON files themselves contain no notice.
- **Errata:** the OCPP-J 1.6 errata sheet (2025-04) is in the same package. It
  says it contains errata on the 1.6-J specification and on the JSON Schema
  files, and that one JSON Schema file was updated in that release. It carries
  "Copyright © 2010 – 2025 Open Charge Alliance" and the same CC BY-ND 4.0
  notice. It leaves the spellings `FormationViolation` and
  `OccurenceConstraintViolation` of the error codes as they are.

## OCPP 2.0.1 — `schemas/2.0.1`

- **Author and copyright holder:** Open Charge Alliance.
- **Official package:** `OCPP-2.0.1_all_files.zip` (OCPP 2.0.1 Edition 4,
  errata 2026-09), the file `OCPP-2.0.1_part3_JSON_schemas.zip` inside it (128
  files). The `ReadMe.md` of the package dates the schemas **2020-03-31**; the
  other parts were updated to Edition 4 on 2025-12-03, and the schemas were not.
- **Downloaded from:**
  <https://openchargealliance.org/download/caaab79c63336ff203104d9940c8eba29adb7d324c384e0578f7f3b7265e03ac/>
  (it redirects to
  `wp-content/uploads/2026/10/OCPP-2.0.1_all_files.zip`) on 2026-11-01.
- **SHA-256 of the package:**
  `9e025b7d0ef45deb221a7b0bb24b6eb0d199dce8927e1512a8aa75419f511a64`
- **SHA-256 of `OCPP-2.0.1_part3_JSON_schemas.zip`:**
  `6279c40b74929cce7fca439622194a8890a0d250de5665f3e4d80ef8529c51ce`
- **Identifiers inside the files:** URNs of the OCA, charge point profile 2, March 2020, written in JSON Schema draft-06.
- **License:** CC BY-ND 4.0. Every document in this package states it. For
  example, Part 4 of the specification says: "Copyright © 2010 – 2025 Open
  Charge Alliance. All rights reserved." and "This document is made available
  under the Creative Commons Attribution-NoDerivatives 4.0 International Public
  License". The `ReadMe.md` describes the package as the OCPP 2.0.1
  specification parts and lists the JSON schemas as Part 3.
- The JSON files themselves contain no notice.

## What was done to the files

Nothing. They were copied with `cp`, and each copy was compared with its source
with `cmp`. Line endings are as published: most 1.6 files use CRLF and the 2.0.1
files use LF. A `.gitattributes` rule keeps Git from converting them, and
Prettier is told to skip them.

## License text

[LICENSE-CC-BY-ND-4.0.txt](LICENSE-CC-BY-ND-4.0.txt) is the plain-text legal code
of the license, as published by Creative Commons at
<https://creativecommons.org/licenses/by-nd/4.0/legalcode.txt>. The repository
keeps an identical copy in `LICENSES/CC-BY-ND-4.0.txt`, and `pnpm lint:schemas`
checks that the two stay the same.

## Not included

OCPP 2.1 (also published as IEC 63584-210, with its own terms), the SOAP
service descriptions, the specification documents, and the CSV appendices.
