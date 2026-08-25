# Nothing auth-shaped rests on disk any more

- **Date:** 2026-08-24
- **Type:** change
- **Scope:** `server`, `cli`

[中文版](2026-08-24-owner-token.zh.md)

The auth scheme kept two long-lived secrets at rest: `auth-token-secret`, a permanent signing
key — a leaked backup of the data root meant forging sessions against the live server, forever —
and the plaintext password paths it inherited. Both anchors are replaced by one deliberately
short-lived one.

## The owner token

`<root>/owner-token` — a fresh random value written at every process start, 0600. Presenting it
to `POST /api/auth/owner` over loopback proves what ownership has always meant here (the ability
to read the data root) and is exchanged for an ordinary signed session. The token signs nothing,
derives from nothing, and dies with the process: a copy that leaks through a backup is
overwhelmingly a value the server no longer honors.

A magic-cookie file plus loopback HTTP rather than a Unix socket, on purpose: it behaves
identically on every platform Node runs on. The cost, stated honestly, is that the ownership
check happens at read time — a value exfiltrated mid-boot stays usable until the next restart, a
bounded window where the signing key's was unbounded.

## The signing key moves into memory

Generated at process start, written nowhere. There is nothing a backup can leak and nothing to
rotate — a restart IS the rotation. The cost lands almost entirely on nobody: hot pushes swap
the App and keep the process (and key) alive; CLI and machine tokens live an hour and are
re-minted on demand; only a browser session across a real restart pays, as one re-typed
password.

## Minting follows

`penguin auth token` now redeems the owner token against the running server — the common case,
since a controller minting on a machine has just probed its server. With the server stopped
there is no key anywhere, so it falls back to the one session shape that needs none: a legacy
database row, which verification has always honored. The row path's foreign key keeps it honest
about accounts — a never-seeded root cannot fake a session for a user that does not exist.
