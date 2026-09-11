# The "+" button parks a typed draft over plain HTTP

- **Date:** 2026-09-11
- **Type:** fix
- **Scope:** `web`

[中文版](2026-09-11-random-id-insecure-context.zh.md)

Parked-draft and user-shortcut ids come from `crypto.getRandomValues` now, not
`crypto.randomUUID`. The latter exists only in a secure context (HTTPS, or localhost), so a Web
App opened over plain HTTP from any address but localhost threw
`crypto.randomUUID is not a function` the moment it had to park a typed draft — a click on "+"
while the draft held text — and every later click failed the same way while that text remained.
The ids keep their shape: `draft-` plus 8 hex characters, `sc-` plus 12.
