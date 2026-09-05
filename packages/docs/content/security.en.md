---
title: Security Model
description: How access works, scenario by scenario — first login, passwords, automation, remote machines, revocation — and the mechanics underneath.
---

PenguinHarness runs agents with real credentials on real machines, so it is worth knowing exactly who can do what, on the strength of which proof. This page walks the model in the order you meet it: claiming a fresh server, managing passwords, automating on the local machine, managing remote machines, and taking access away. The mechanics — token format, what is on disk, the network surface — are collected at the end.

One principle carries every scenario:

> **Reading the data root is ownership.** The data root (`~/.penguin/data` by default) holds every model credential and every conversation. A secret stored beside them could not guard them from someone who can already read them — so the model never pretends otherwise, and instead makes that ownership safe to exercise: short-lived, revocable, and never requiring a password to be stored or transmitted.

## 0. What you get

| Capability | Where |
| --- | --- |
| Claim a fresh server through a printed sign-in link — no password exists yet, none is shown | The startup notice |
| Sign in with a password; storage is scrypt hashes, attempts are throttled | Web login page, `penguin auth login` |
| The desktop app signs its own window in, silently | One-shot token at window open |
| Mint a session from local ownership — no password involved | `penguin auth token` |
| Manage machines over ssh with no password on the wire | The Machines page |
| Sessions are server-side rows: individually revocable, surviving a restart, 30-day sliding renewal | Everywhere |
| Every session records how it was established | `via`: `password` (a typed password, or a session minted by `penguin auth token`) / `desktop` / `setup` / `token` (a request carrying the local API token as a Bearer header — no stored session) |
| Revoke one session, or every session a user holds | Logout / admin password reset |
| Recover a lost admin password from the machine itself | `penguin server reset-admin-password` |

## 1. Claiming a fresh server

**Web.** A fresh server has no usable password: the seeded value is generated, hashed, and discarded unseen. To let you in anyway, every start prints a sign-in link until a password is set:

```
+--------------------------------------------------------------------+
|   This server has no admin password yet. Open this link to claim:   |
|                                                                     |
|     http://localhost:7364/api/auth/claim?token=...                  |
|                                                                     |
|   The link works until a password is set, and changes on restart.   |
+--------------------------------------------------------------------+
```

Open it, land signed in, set a password. The link is not one-shot — a mail client may fetch it before you do, and a second open must still work — so three other bounds make it printable into a console:

- It works **only while the server is unclaimed**. Once a password exists it is refused, so a console scrollback is not a way in.
- The value it is compared against lives **in memory and is re-minted on every restart**. A link from an earlier run is refused; if you miss the notice, restart and read the new one.
- A wrong token and an already-claimed server answer **identically** — a stale link cannot even reveal which of the two it is.

In a container the notice goes to the container's log (`docker logs`), and the `localhost` in the link is the server's own view of itself — replace it with the host you reach the container on, and keep the token. `PENGUIN_SEED_ADMIN_PASSWORD` pins the password instead, but only on the first boot of an empty data root.

The session it grants carries `via: setup`. It has exactly one special allowance — setting a password without an old one, since no old one exists — and no more: in particular, none of the desktop-only routes.

**Desktop.** The shell owns the server process it embeds, so its window is let in on that fact alone: the window's first navigation redeems a one-shot token minted by the shell, and lands signed in as `via: desktop`. The token dies on redemption — a leaked URL replays nothing.

Password logins, wherever they come from, are throttled per username with exponential backoff — and unknown usernames are throttled identically, so timing does not reveal whether an account exists.

## 2. Passwords

A chosen password is stored one way only: as an scrypt hash (`N=16384`, per-password salt, parameters stored alongside so cost can rise later). Four ways to set one, each shaped by who is asking:

- **You, knowing the current password** — user settings. The current password is verified first.
- **You, in a session that never had one** — a `setup` session (§1), or the desktop shell's own window. Both belong to accounts whose password is a random value nobody has seen, so there is nothing to put in an "old password" field; the session's provenance is the authorization.
- **An admin, for another user** — the account gets a fresh initial password, and every session that user holds is revoked (§5).
- **Nobody remembers the admin password** — on the server's machine, with the server stopped: `penguin server reset-admin-password`. Local filesystem access is the authorization. The account returns to the unclaimed state with its sessions revoked, and the rescue produces nothing to write down — start the server and claim it through the link, as in §1.

## 3. Automation on this machine

Scripts and the CLI never need a password, because local ownership already outranks one. A session is a row in the data root's `web.db`, so the CLI writes one:

```bash
penguin auth token          # no password, no prompt: inserts a session row
```

Being able to read and write that data root is the whole authorization, and it grants nothing new — the root already holds every credential the token could reach. It works whether or not a server is running, and safely alongside one — on a root a server has started at least once, since the account it mints for lives in that root's `web.db`. The token lives an hour by default (`--ttl-seconds` sets another lifetime) and acts as an ordinary password session, never the desktop kind.

On a multi-user machine that scoping is the point: the data root belongs to the OS account running the server, so only that account can mint. Everyone else signs in with a password — `penguin auth login --server <url>`.

## 4. Remote machines: ssh access is CLI access

The Machines page manages other machines over ssh, and the identity everything runs under is the ssh account's:

- To act on a machine's API, the controller runs `penguin auth token` **on that machine, over ssh**. The machine's own CLI writes a session row into the machine's own database. The only thing that crosses the wire is a one-hour session token.
- **No password crosses the wire, ever.** A machine's admin password stays on that machine; ssh has already proven everything a password would.
- The equation cuts both ways. ssh access to a machine can read its data root by hand, so the token grants nothing ssh had not already granted — and precisely for that reason, **your ssh key is the master credential for every machine it reaches**. Guard it at that level.
- A Project that syncs model credentials to its machines puts those API keys in each machine's own Project config (mode 0600): a machine that runs your agents necessarily holds the keys they run with.

## 5. Taking access away

| To revoke | Do | Effect |
| --- | --- | --- |
| One session | `penguin auth logout`, or sign out in the UI | Immediate — the row is deleted, and a session is its row |
| One user's sessions | Admin password reset for that user | Immediate — every row for that account is deleted |
| The admin's own sessions | `penguin server reset-admin-password` (server stopped) | On the next start, which prints a fresh first-login link |
| A model API key | Rotate it with the provider, update the Project config | Provider-side |

The scenario the design is built around is the worst one — **a full data-root backup leaks**. The response is a credential rotation for the model API keys it contains, and nothing more: passwords in a backup are scrypt hashes, and the session table holds only the sha256 of each token, never a token. Nothing copied out of a backup can be presented to the live server as a session.

## The mechanics underneath

**Sessions.** The cookie carries a 32-byte random token; the `auth_sessions` row keyed by its sha256 is the session, and holds the account, the provenance (`via`) and the expiry. Because the row is the session, deleting it revokes immediately and a restart signs nobody out. Browser sessions run 30 days and renew **in place** as expiry nears — the row's expiry moves, the cookie value does not — so one in regular use never expires and there is never a second copy to chase. Only a session whose own term reaches the renewal window slides, so an hour-long minted token expires at its hour. Cookies are HttpOnly and SameSite=Lax, plus Secure when the request is really https or a **trusted** proxy says so (`PENGUIN_TRUST_PROXY=1`); the header is ignored by default.

**On disk, and deliberately not.**

| File | Contains | Lives |
| --- | --- | --- |
| `web.db` | Password **hashes**, session **hashes**, application data | Permanently |
| `<project>/.project_config.toml` | Model API keys, inline, mode 0600 | Until edited |
| `cli-session.json` | One live session token, mode 0600 | Until logout or expiry |

Never on disk in usable form: session tokens (only their sha256) and every password — chosen ones exist as scrypt hashes, seeded ones are discarded at birth. Model API keys are the irreducible remainder: they must reach upstream providers verbatim, so they cannot be hashed. They are confined to the Project config, masked in every API response and UI surface, and read in plaintext only at the moment a request is made.

**Network surface.** The server binds 127.0.0.1 by default; exposing it (`HOST=0.0.0.0`) is a deployment decision that belongs behind TLS termination, with the proxy setting `x-forwarded-proto`. The API answers only under its canonical application host, which keeps user-generated preview content in a separate browser origin from the application's cookies. Cross-site request forgery is blocked by two independent layers: the SameSite=Lax cookie, and a Content-Type gate that rejects any write request whose content type an HTML form could produce.
