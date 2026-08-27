# `penguin auth` — terminal sign-in, first-login links, offline admin reset

- **Date:** 2026-08-24
- **Type:** feature
- **Scope:** `cli`, `server`, `docs`
- **PR:** [#443](https://github.com/Prism-Shadow/penguin-harness/pull/443)
- **Breaking:** yes — the fixed seed password retires; claim the account through the printed first-login link

[中文版](2026-08-24-penguin-auth.zh.md)

Signing in to a server from a terminal is now possible, and the account bootstrap around it is
rebuilt: a fresh server prints a first-login link instead of a fixed password, and a forgotten
admin password is recovered offline.

```bash
penguin auth login                      # password, against the server on this data root
penguin auth login --server https://penguin.example --user-id alice
penguin auth status
penguin auth logout
penguin auth token                      # no password: writes a session row on this machine
```

## Details

- `login` asks a running server for a session, defaulting to the server on this data root, read
  from a *live* lock (PID + port). Interactively it asks for the account and names it in the
  password prompt; `PENGUIN_PASSWORD` or `--password` supplies the password and it asks nothing.
  Prefer the environment variable — a command line is world-readable through `ps`.
- `token` takes no password: it opens `web.db` and inserts a session row, so it needs no running
  server and is safe alongside one (WAL + busy timeout). Bare output for
  `TOKEN=$(penguin auth token)`; `--mark` prefixes a marker line for a caller parsing it out of a
  shell that may print a banner.
- The CLI session is stored at `<root>/cli-session.json`, mode 0600 through a symlink-refusing
  write. `logout` ends it on the server, not only locally.

## First login

A fresh server's seed password is 24 base64url characters (144 bits), generated, hashed and
discarded unseen. Every start prints a sign-in link until a password is set. The link carries a
`setup` session — it may set a password without the old one, and opens no desktop-only route —
redeemed at `GET /api/auth/claim`, which also serves the desktop shell's one-shot token. It is
reusable until claimed and stops working the moment a password exists; a claimed server mints no
such session.

`penguin server reset-admin-password` returns the admin to that unclaimed state offline (server
stopped), deleting its sessions and producing no plaintext; the next start prints a fresh link.

## Sessions

A session is a 32-byte random token in the cookie, stored as its sha256 in `auth_sessions`.
Logout deletes the row, an admin password reset deletes that user's rows, and a session survives
a restart. Validity is **30 days** (previously 7) with sliding renewal topped up in place, so the
cookie value never changes; only a session whose own span reaches the renewal window slides, so
an hour-long `cli` token expires at its hour.

## Compatibility

The fixed seed password (`PENGUIN_SEED_ADMIN_PASSWORD` unset used to print `penguin-<4 digits>`)
retires: claim the account through the first-login link the server prints instead. A data root
carried over from an earlier build has any `initial-admin-password` plaintext deleted at the next
start.

Sessions in a v0.2.0 `web.db` are kept: `auth_sessions` gains its `via` column at the next start
and existing rows read as ordinary password sessions, so an upgrade does not sign anyone out.

Session cookies carry `Secure` only where the deployment opts in. An HTTPS deployment behind a
reverse proxy sets `PENGUIN_TRUST_PROXY=1` and keeps forwarding `x-forwarded-proto`; left unset,
cookies are issued without the flag.

`penguin server auth-token` is now `penguin auth token`; `GET /api/auth/desktop-login` is now
`GET /api/auth/claim`.
