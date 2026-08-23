# Paging query params reject trailing garbage, and route comments drop their design-doc codes

- **Date:** 2026-08-23
- **Type:** fix
- **Scope:** `server`
- **PR:** [#410](https://github.com/Prism-Shadow/penguin-harness/pull/410)

[中文版](2026-08-23-paging-params-reject-trailing-garbage.zh.md)

`offset` and `limit` were parsed with `Number.parseInt` and then only range-checked, so a
value that merely started with digits was accepted: `?limit=200abc` paged at 200 and
`?limit=1e3` paged at 1. Both now go through the same digits-only parse
`positiveIntParam` already used, and answer 400 instead. Thirteen route comments that
cited design-session item codes (`FD-1`, `FD-3`, `FD-4`) were rewritten to state the rule
they were pointing at.

## Details

- `paginationQuery` and `optionalPagingQuery` share one `parseNonNegativeInt` helper with
  `positiveIntParam`: a decimal digit run that lands on a safe integer, or a 400. Leading
  signs, whitespace, decimal points, hex and exponent forms are all rejected.
- The accepted ranges are unchanged — `offset` >= 0 (default 0), `limit` 1–1000 (default
  200 for the Trace pagination helper) — as is the "offset requires limit" rule and the
  both-absent `null` return.
- Affected endpoints: the Trace message and event pages, the usage error detail table, and
  the Session and Trace list endpoints.
- The route comments now name the invariant directly ("id validation happens before any
  path construction: prevents agentId path traversal for cross-Project privilege
  escalation") rather than deferring to a code no reader at `HEAD` can resolve.
