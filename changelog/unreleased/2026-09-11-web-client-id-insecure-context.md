# Client ids minted where `crypto.randomUUID` does not exist

- **Date:** 2026-09-11
- **Type:** fix
- **Scope:** `web`

[中文版](2026-09-11-web-client-id-insecure-context.zh.md)

The web app stopped calling `crypto.randomUUID`, which browsers define only in a secure context. A harness reached over plain HTTP — the usual `http://<host>:7364` on a LAN — had the button that starts a new conversation and the one that saves a shortcut die with `TypeError: crypto.randomUUID is not a function`, before any request was sent.

## Details

- `randomUuid()` (`packages/web/src/lib/random-uuid.ts`) assembles a v4 UUID from `crypto.getRandomValues`, which carries no secure-context restriction, and falls back to `Math.random` only where Web Crypto is absent altogether. It is random, not secret: these ids are handles the server stores and hands back, and nothing authenticates against them.
- The two callers — the parked-draft id (`features/chat/draft-sessions.ts`) and the saved-shortcut id (`features/chat/user-shortcuts.ts`) — now take their id from it, slicing it exactly as before, so the `draft-` and `sc-` prefixes and their lengths are unchanged.
- `test/random-uuid.test.ts` pins the v4 shape and both contexts: an id is minted with `Crypto.prototype.randomUUID` removed, and again with no Web Crypto on the global at all.
