# `penguin auth`, signed sessions, and no auth secret at rest

- **Date:** 2026-08-24
- **Type:** feature
- **Scope:** `cli`, `server`, `docs`
- **PR:** [#443](https://github.com/Prism-Shadow/penguin-harness/pull/443)
- **Breaking:** yes — upgrading signs everyone out once, and `penguin auth token` needs a running server

[中文版](2026-08-24-penguin-auth.zh.md)

Signing in to a server from a terminal is now possible, and the session mechanism underneath it
changed to suit it: sessions became signed tokens, the signing key moved into process memory,
and the last two long-lived secrets left the data root.

```bash
penguin auth login                      # password, against the server on this data root
penguin auth login --server https://penguin.example --user-id alice
penguin auth status
penguin auth logout
penguin auth token                      # no password: proves local ownership instead
```

## Two ways in

`login` asks a running server for a session, defaulting to the one on this data root so signing
in to your own needs no URL. Interactively it asks for the account first and names it in the
password prompt; supply the password through `PENGUIN_PASSWORD` or `--password` and it asks
nothing. Prefer the environment variable — a command line is world-readable through `ps`.

`token` takes no password. Being able to read the data root is what authorizes it, so it fits a
machine whose admin password somebody set by hand, or a script that must not carry one. It
prints the token bare for `TOKEN=$(penguin auth token)`; `--mark` prefixes a marker line for a
caller parsing it out of a shell that may print a banner.

The session is remembered in `<root>/cli-session.json` at mode 0600. `logout` revokes it on the
server, not only locally.

## Sessions

A session is now `v1.<claims>.<hmac>` — account, provenance, expiry, unique id — verified with
signature arithmetic plus one user lookup instead of a database read per request. The
`auth_sessions` table is gone with it: the database records only exceptions now, a logout in a
revocation table and an admin password reset as a per-user mark that invalidates that user's
earlier tokens.

Browser sessions run **30 days** (previously 7) and renew by replacement cookie as expiry nears,
so one in regular use never expires; hour-long minted tokens never renew. Provenance grants
nothing on its own — anything that is not `desktop` reads as an ordinary password session.

## Nothing auth-shaped rests on disk

The signing key is generated at process start and written nowhere, so a restart rotates every
outstanding session. Hot updates keep the process, and CLI and machine tokens re-mint on demand;
a browser session across a real restart costs one re-typed password.

Local ownership is anchored by `<root>/owner-token`: a fresh random value written at every start,
mode 0600, redeemed at `POST /api/auth/owner`. A stopped server cannot mint at all: the key
that would sign the token is not anywhere to be found, so the answer is to start it.

A fresh server's seed password is 24 base64url characters — 144 bits — generated, hashed and
discarded unseen, so the account is unguessable at the login endpoint from the moment it exists
even though nobody can read it. Every start prints a one-time sign-in link until a password is
set. The link carries an ordinary `setup` session —
one that may set a password without an old one, and opens no desktop-only route — and is
redeemed at `GET /api/auth/claim`, which also serves the desktop shell's one-shot token.
`penguin server reset-admin-password` returns the admin account to that unclaimed state and
produces no plaintext.

## Compatibility

A data root carried over from an earlier build has its `initial-admin-password` file deleted at
the next server start. The account's password is unchanged, and a server still on its initial
password prints the sign-in link instead. The sweep is removed once no supported upgrade path
can carry that file — tracked in `initial-password.ts`.

Sessions from an earlier version are not carried over: the `auth_sessions` table is dropped, so
everyone signs in once after the upgrade. Restarting already ends every session in this model,
and an upgrade is a restart.

`penguin auth token` now requires a running server to sign for it, and says so when there is
none. `penguin server auth-token` is now `penguin auth token`; `GET /api/auth/desktop-login` is
now `GET /api/auth/claim`.
