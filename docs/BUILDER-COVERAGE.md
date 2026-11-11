# Builder coverage

- Date: 2026-11-11
- Command: `pnpm test:coverage:builder`
- Enforced thresholds: 90% statements, 90% functions, 90% lines, 85% branches.
- Scope: `packages/builder/src/**/*.ts`.

## Current result

| File         | Statements | Branches | Functions |  Lines |
| ------------ | ---------: | -------: | --------: | -----: |
| All files    |      94.67 |    93.91 |     98.52 |  96.30 |
| `frame.ts`   |      95.91 |    91.83 |    100.00 | 100.00 |
| `index.ts`   |      92.79 |    95.50 |    100.00 |  93.06 |
| `json.ts`    |      97.91 |    97.22 |    100.00 |  97.77 |
| `payload.ts` |      93.75 |    92.27 |    100.00 |  96.98 |
| `schema.ts`  |      92.85 |    90.90 |     87.50 |  92.10 |

The remaining uncovered lines are a mix of defensive `catch` blocks, limit
checks, and early-return branches that the public behavior tests do not reach as
distinct statements.

## Per-file exception

`schema.ts` is at 87.5% function coverage, below the 90% per-file target. The
only uncovered function is the rejection handler of the loader cache:

```ts
() => {
  this.cache.delete(key);
};
```

`SchemaLoader.loadUncached` converts every failure (loader rejection,
`undefined`, module namespace, normalize error, resolve error) into a
`BuilderResult` with `ok: false`. The promise therefore does not reject in
practice, and the handler is unreachable without removing the defensive code.
The global thresholds still pass, and the handler stays.

If `loadUncached` gains a path that can reject, add a test and remove this
exception.

## Scope notes

- The suite is synthetic. Real OCA schemas are loaded at runtime, never copied
  into fixtures.
- `perFile` is not enabled because of the exception above. Every other file is
  above 90/85 on its own.
