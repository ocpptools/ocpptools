# 0003. OCA JSON Schemas: attribution, license, and where they live

- Status: accepted
- Date: 2026-11-01

## Context

OCPP 1.6J and 2.0.1 messages are described by JSON Schema files written and
published by the Open Charge Alliance (OCA). The validator, the builder, and
users of this project need them. Until now the repository kept them out, because
their license had not been reviewed.

Facts, checked on 2026-11-01 in the official OCA downloads (the 1.6 documentation
package and the OCPP 2.0.1 Edition 4 package):

- The OCA is the author and holds the copyright. The OCA site says OCPP is
  freely available to download. The OCA publishes the specification and no
  software.
- Every specification document in both packages states "Copyright © … Open
  Charge Alliance. All rights reserved." and that it is made available under the
  Creative Commons Attribution-NoDerivatives 4.0 International Public License
  (CC BY-ND 4.0). The two SOAP service descriptions (`.wsdl`) in the 1.6 package
  carry the same notice in their headers.
- The 2.0.1 package describes itself as the OCPP 2.0.1 specification parts and
  lists the JSON schemas as Part 3. The 2.0.1 schemas are dated 2020-03-31 and
  were not changed by Edition 4 or by its errata.
- The OCPP-J 1.6 errata sheet (2025-04) states CC BY-ND 4.0 and says it
  contains errata on "the OCPP 1.6-J specification (JSON) and JSON-Schema
  files". It also says that one JSON schema was updated in that release
  (`StopTransaction`; the other 1.6J schemas date from 2019-12). The OCA
  treats the schema files as part of the specification it publishes under that
  license.
- **The JSON schema files themselves carry no license notice**, and the OCA
  site and terms of service say nothing about them. Nothing in the packages
  states that they are excluded from CC BY-ND 4.0 either.
- CC BY-ND 4.0 lets anyone copy and share the material in any medium, including
  commercially, with attribution. It does not let anyone share modified
  material. Producing modified material for one's own use, without sharing it,
  is allowed.
- The copies of the schemas kept in the private website that this project grew
  out of are identical to the official files (1.6J byte for byte; 2.0.1 except
  for line endings added by Git on Windows).

Not verified: that CC BY-ND 4.0 covers the JSON files themselves. It is very
likely, but the OCA has not said so in writing.

## Decision

1. **The OCA is credited as author and source.** The READMEs, `NOTICE`,
   `packages/schemas/SOURCES.md`, and the REUSE metadata name the Open Charge
   Alliance as the author and copyright holder of the schemas, link to the
   official download, and record the exact package, date, and hash each file came
   from. The project does not present the schemas as its own work or as endorsed
   by the OCA.
2. **One place, and only unmodified copies.** The schemas live only in
   `packages/schemas/schemas`, as byte-for-byte copies of the originals for OCPP
   1.6J and OCPP 2.0.1. Nothing is formatted, re-encoded, renamed, or
   normalized, and line endings are kept as published. `.gitattributes` stops
   Git from converting them and Prettier skips them. `manifest.json` holds the
   SHA-256 of every file, and `pnpm lint:schemas` (also a CI job) fails if a file
   differs, is missing, or is not listed.
3. **The original license travels with them.** The package ships the CC BY-ND
   4.0 legal code as published by Creative Commons, and the repository keeps an
   identical copy in `LICENSES/CC-BY-ND-4.0.txt`; the check above fails if the
   two differ. REUSE marks every schema file as `CC-BY-ND-4.0` with the Open
   Charge Alliance as copyright holder. The package license is
   `Apache-2.0 AND CC-BY-ND-4.0`: Apache-2.0 for our own files and CC BY-ND 4.0
   for the schemas. We add no terms to the schemas and do not relicense them.
4. **Nothing derived is shared.** No package includes or republishes adapted
   material: normalized or resolved schemas, schemas without vendor keywords,
   generated types, or field metadata. `schema-utils` and the validator take
   schemas as input and may transform them in memory, inside the user's
   process, which is not sharing. Tests use synthetic schemas.
5. **The package is published, and the maintainers accept the remaining
   risk.** `@ocpptools/schemas` is a public package. The OCA has not confirmed
   in writing that the JSON files are covered by CC BY-ND 4.0 and may be
   redistributed unmodified. The maintainers decided on 2026-11-01 to publish
   anyway: the files come from the same official packages as documents and
   schema descriptions that all state CC BY-ND 4.0, the OCA says OCPP is freely
   available to download, and the package keeps the files unmodified with the
   license, the author, and the source. A written confirmation from the OCA would
   remove the risk. If the OCA objects or states other terms, the maintainers
   will deprecate and remove the affected versions and files, and record the
   change here.
6. **Scope.** OCPP 1.6J and OCPP 2.0.1 JSON schemas only. OCPP 2.1 (also
   published as IEC 63584-210, with its own terms), the SOAP service
   descriptions, the specification documents, and the CSV appendices are not
   included.
7. **The guard allows them in one place.** `pnpm lint:schemas` still fails on
   anything that looks like an OCA schema outside `packages/schemas/schemas`.

## Consequences

- Validator and builder can be tested and used against the real schemas, and
  users do not have to find and download them by hand once the package is
  published.
- Updating to a new OCA edition is a deliberate change: replace the files with
  the new originals, update `manifest.json` and `SOURCES.md` together, and note
  the edition in the change.
- The repository now contains material that is not Apache-2.0. REUSE, the
  package license expression, and the READMEs make that explicit, but anyone
  who copies the repository must keep the CC BY-ND 4.0 notices.
- Typed payloads generated from the schemas cannot ship inside the project.
  Users can generate them for themselves.
- The risk that the OCA did not intend the JSON files to be covered remains
  until it answers, and publishing makes the files available to anyone who
  installs the package. The maintainers accept that (decision 5).
- Trademark: "OCPP" is a mark of the Open Charge Alliance. See
  [TRADEMARKS.md](../../TRADEMARKS.md).
