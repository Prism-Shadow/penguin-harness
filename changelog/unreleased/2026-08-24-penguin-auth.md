# `penguin auth` — terminal sign-in, first-login links, offline admin reset

- **Date:** 2026-08-24
- **Type:** feature
- **Scope:** `cli`, `server`, `docs`
- **PR:** [#443](https://github.com/Prism-Shadow/penguin-harness/pull/443)
- **Breaking:** yes — the fixed seed password retires; claim the account through the printed first-login link

[中文版](2026-08-24-penguin-auth.zh.md)

Signing in to a server from a terminal is now possible, and the account bootstrap around it is
rebuilt: a fresh server prints a first-login link instead of a fixed password, and a forgotten
admin password is recovered offline. Sessions stay server-side rows in `web.db`, so they
outlive a restart.

```bash
penguin auth login                      # password, against the server on this data root
penguin auth login --server https://penguin.example --user-id alice
penguin auth status
penguin auth logout
penguin auth token                      # no password: writes a session row on this machine
```

## Two ways in

`login` asks a running server for a session, defaulting to the one on this data root so signing
in to your own needs no URL. Interactively it asks for the account first and names it in the
password prompt; supply the password through `PENGUIN_PASSWORD` or `--password` and it asks
nothing. Prefer the environment variable — a command line is world-readable through `ps`. The
default target is taken from a *live* server lock (PID + port), so a password never goes to a
stale lock's port that another process may now hold.

`token` takes no password. A session is a row in `web.db`, so it opens the database and inserts
one — reading the data root already reaches every credential the token could, so the write adds
no authority. It needs no running server, works while one is up (WAL + busy timeout), and fits a
machine whose admin password somebody set by hand or a script that must not carry one. Bare for
`TOKEN=$(penguin auth token)`; `--mark` prefixes a marker line for a caller parsing it out of a
shell that may print a banner.

The CLI session is remembered in `<root>/cli-session.json` at mode 0600 (a symlink-safe write);
`logout` deletes it on the server, not only locally.

## First login and admin recovery

A fresh server's seed password is 24 base64url characters (144 bits), generated, hashed and
discarded unseen — unguessable at the login endpoint from the moment the account exists, and
read by nobody. Every start prints a sign-in link until a password is set. The link carries a
`setup` session — one that may set a password without an old one, and opens no desktop-only
route — redeemed at `GET /api/auth/claim` (which also serves the desktop shell's one-shot
token). It is deliberately reusable until claimed: a link a mail client or browser may prefetch
must not be spent before its reader opens it, and it stops working the moment a password exists.
A claimed server mints no such session at all.

`penguin server reset-admin-password` returns the admin to that unclaimed state offline (server
stopped), deleting its sessions and producing no plaintext; the next start prints a fresh link.

## Sessions

A session is a 32-byte random token in the cookie, stored as its sha256 in `auth_sessions`; the
row is the session, so logout deletes it and an admin reset deletes the user's rows. Validity is
**30 days** (previously 7) with sliding renewal topped up in place — the cookie value never
changes — and only sessions whose own span reaches the renewal window slide, so an hour-long
`cli` token expires at its hour. A session survives a server restart, because it is on disk.

## Compatibility

The fixed seed password (`PENGUIN_SEED_ADMIN_PASSWORD` unset used to print `penguin-<4 digits>`)
retires: claim the account through the first-login link the server prints instead. A data root
carried over from an earlier build has any `initial-admin-password` plaintext deleted at the
next start (swept until no supported upgrade path can carry it — tracked in
`initial-password.ts`).

Sessions in a v0.2.0 `web.db` are kept: the `auth_sessions` table gains its `via` column on the
next start and existing rows read as ordinary password sessions, so an upgrade from a release
does not sign anyone out. (Sessions issued by an unreleased build in between — the interim
signed-token scheme — are not rows at all and simply stop working.)

The `Secure` flag on session cookies now requires the deployment's opt-in: `x-forwarded-proto`
used to be believed unconditionally, which let anyone reaching a plain-HTTP port force a
`Secure` cookie the browser then never sends back over that connection. An HTTPS deployment
behind a reverse proxy sets `PENGUIN_TRUST_PROXY=1` (and keeps forwarding `x-forwarded-proto`)
to keep its session cookies `Secure`; left unset, they are issued without the flag.

`penguin server auth-token` is now `penguin auth token`; `GET /api/auth/desktop-login` is now
`GET /api/auth/claim`.
