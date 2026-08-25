# Nothing auth-shaped rests on disk any more

- **Date:** 2026-08-24
- **Type:** change
- **Scope:** `server`, `cli`

[中文版](2026-08-24-owner-token.zh.md)

The auth scheme kept two long-lived secrets at rest: `auth-token-secret`, a permanent signing
key — a leaked backup of the data root meant forging sessions against the live server, forever —
and `initial-admin-password`, a password in the clear. Both are gone. **Nothing auth-shaped
rests on disk any more.**

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

## First login is a link, not a password

A fresh server's seed password is now generated, hashed and discarded — nobody ever sees it.
What the operator gets instead is a one-time sign-in link carrying this boot's first-login
token, printed in the same framed notice on every start until a password is actually set.

The link is safe enough to print because of what bounds it: it works only while the server is
unclaimed, its token lives in memory and is reissued on every restart, and a wrong token and an
already-claimed server answer identically. The session it grants is marked `via: "setup"` — it
may set a password without knowing the old one (there is no old one), and it opens no
desktop-only route.

`penguin server reset-admin-password` follows the same shape: it returns the admin account to
the unclaimed state and revokes its sessions, producing no plaintext to write down. The rescue
is "start the server and open the link it prints".

## Compatibility

A data root carried over from an older build has its `initial-admin-password` file **deleted at
the next server start**. Nothing is lost: the account's password is unchanged, and a server
still on its initial password prints the first-login link instead. The sweep runs
unconditionally and is removed once no supported upgrade path can still carry that file —
tracked with the file's own deletion, in `initial-password.ts`.
