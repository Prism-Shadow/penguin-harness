---
title: Security Model
description: How access to PenguinHarness works, from claiming a fresh server to revoking sessions, plus the mechanics underneath.
---

PenguinHarness runs agents with real credentials on real machines, so it is worth knowing exactly who can do what, and on what proof. This page follows the scenarios in the order you meet them, and collects the mechanics (session tokens, what is on disk, the network surface) at the end.

- **First start of a new server?** See [Claim a fresh server](#claim-a-fresh-server).
- **Need to set, change, or recover a password?** See [Manage passwords](#manage-passwords).
- **Scripting or using the CLI on the same machine?** See [Automate on the local machine](#automate-on-the-local-machine).
- **Driving other machines over ssh?** See [Manage remote machines over ssh](#manage-remote-machines-over-ssh).
- **Need to take access away?** See [Revoke access](#revoke-access).

One principle runs through every scenario:

> **Reading the data root is ownership.** The data root (`~/.penguin/data` by default) holds every model credential and every conversation. A secret stored beside them could not protect them from someone who can already read them, so the model never pretends otherwise. Instead, it makes that ownership safe to use: short-lived, revocable, and never requiring a password to be stored or sent.

## What you get

| Capability | Where |
| --- | --- |
| Claim a fresh server through a printed sign-in link; no password exists yet, and none is shown | The startup notice |
| Sign in with a password, stored as an scrypt hash, with attempts throttled | Web login page, `penguin auth login` |
| The desktop app signs its own window in, silently | A one-shot token when the window opens |
| Mint a session from local ownership, with no password involved | `penguin auth token` |
| Manage machines over ssh with no password on the wire | The **Machines** page |
| Sessions are server-side rows: revocable one by one, surviving a restart, renewed while in use (30 days) | Everywhere |
| Every session records how it was established | Its `via` value (see below) |
| Revoke one session, or every session a user holds | **Sign out**, admin password reset |
| Recover a lost admin password from the machine itself | `penguin server reset-admin-password` |

Each session's `via` value records how it was established:

- `password`: a typed password, or a session minted by `penguin auth token`
- `desktop`: the desktop app's own window
- `setup`: the sign-in link on a fresh server
- `token`: a request that carries the local API token as a Bearer header; no session is stored

## Claim a fresh server

A fresh server has no usable password: the seeded value is generated, hashed, and discarded unseen. To let you in anyway, the server prints a sign-in link at every start until a password is set:

```
+---------------------------------------------------------------------------------------+
|   This server has no admin password yet. Open this link to claim it:                  |
|                                                                                       |
|     http://localhost:7364/api/auth/claim?token=...                                    |
|                                                                                       |
|   The link lasts 30 days or until a password is set; restarting prints a fresh one.   |
+---------------------------------------------------------------------------------------+
```

1. Start the server.
2. Copy the sign-in link from the startup output.
3. Open the link in a browser. You land signed in as the built-in `admin` account.
4. Set a password.

### Why the link is safe to print

The link is not one-shot, because a mail client may fetch it before you do and a second open must still work. Three other limits make it safe to print to a console:

- It works **only while the server is unclaimed**, and for at most 30 days. Once a password exists it is refused, so a console scrollback is not a way in.
- The value it is checked against lives **in memory and is replaced at every restart**. A link from an earlier run is refused; if you missed the notice, restart the server and read the new one.
- A wrong token and an already-claimed server get **the same answer**, so a stale link cannot even reveal which of the two it is.

> [!NOTE]
> In a container, the notice goes to the container's log (`docker logs`). The `localhost` in the link is the server's own view of itself. With the documented loopback port mapping, that is your view too, so open the link as printed on the machine running Docker. If the container is published to a network, replace `localhost` with the host you reach it on. Keep the token as it is either way.

`PENGUIN_SEED_ADMIN_PASSWORD` pins the password instead, but only on the first start with an empty data root.

The session the link grants carries `via: setup`. It has exactly one special allowance, setting a password without entering an old one (none exists), and nothing else; in particular, it gets none of the desktop-only routes.

### Sign in from the desktop app

The desktop app's shell owns the server process it embeds, so its window is let in on that fact alone. The window's first navigation redeems a one-shot token the shell minted, and lands signed in with `via: desktop`. The token dies when it is redeemed, so a leaked URL replays nothing.

## Manage passwords

A password must be at least 8 characters. It is stored one way only: as an scrypt hash (`N=16384`, a salt per password, and the parameters stored alongside so the cost can rise later). There are four ways to set one, depending on who is asking.

### Change your own password

If you know the current password, use **Change password** in your user settings (see [Change your password](/settings#change-your-password)). The current password is verified first.

### Set a password without an old one

A `setup` session (see [Claim a fresh server](#claim-a-fresh-server)) or the desktop app's own window can set a password without supplying an old one. Both belong to accounts whose password is a random value nobody has seen, so there is nothing to enter as the old password. How the session was established is the authorization.

### Reset another user's password

An admin sets a new initial password for another account with **Reset password** in user management (see [Reset a user's password](/settings#reset-a-users-password)). The user is asked to change it at the next sign-in, and every session that user holds is revoked. See [Revoke access](#revoke-access).

### Recover a lost admin password

**Before you begin**

- Access to the server's machine, with the server stopped. Local filesystem access is the authorization.

1. Run `penguin server reset-admin-password`.
2. Start the server. It prints a fresh sign-in link.
3. Open the link and set a password, as in [Claim a fresh server](#claim-a-fresh-server).

The admin account returns to the unclaimed state, and all of its sessions are revoked. The rescue produces nothing to write down.

### Sign-in attempt limits

Password logins, wherever they come from, are throttled per username with exponential backoff. After five failed attempts, each further attempt waits 1 second, doubling up to 60 seconds. Unknown usernames are throttled identically, so the throttling does not reveal whether an account exists. Neither does the response time: an unknown username is checked against a dummy hash, so every attempt costs exactly one scrypt derivation.

## Automate on the local machine

Scripts and the CLI never need a password, because local ownership already outranks one.

When a CLI command runs against a server on this machine, it authenticates with the local API token, which the server writes to `<root>/api-token` at every start. See [CLI Reference](/cli#server-connection).

A script that needs a session of its own mints one. A session is a row in the data root's `web.db`, so the CLI writes one:

```bash
penguin auth token          # no password, no prompt: inserts a session row
```

Being able to read and write the data root is the whole authorization, and it grants nothing new: the root already holds every credential the token could reach. Minting works whether or not a server is running, and safely alongside one, on any root a server has started at least once: the account it mints for lives in that root's `web.db`.

The minted token lives one hour by default and acts as an ordinary password session, never the desktop kind. Pass `--ttl-seconds` to set another lifetime (at most 30 days), or `--user-id` to mint for an account other than `admin`.

On a multi-user machine, that scoping is the point. The data root belongs to the OS account running the server, so only that account can mint. Everyone else signs in with a password: `penguin auth login --server <url>`.

## Manage remote machines over ssh

The **Machines** page manages other machines over ssh, and everything runs under the ssh account's identity.

To act on a machine's API, the controller runs `penguin auth token` on that machine, over ssh. The machine's own CLI writes a session row into the machine's own database. The only thing that crosses the wire is a one-hour session token.

No password crosses the wire, ever. A machine's admin password stays on that machine, because ssh has already proven everything a password would.

> [!WARNING]
> The trust cuts both ways. Anyone with ssh access to a machine can read its data root by hand, so a minted token grants nothing ssh had not already granted. For exactly that reason, your ssh key is the master credential for every machine it reaches. Guard it at that level.

A Project that syncs model credentials to its machines puts those API keys in each machine's own Project config (mode 0600). A machine that runs your agents necessarily holds the keys they run with.

## Revoke access

A session is a row on the server, so deleting the row revokes the session at once.

| To revoke | Do this | Takes effect |
| --- | --- | --- |
| One session | `penguin auth logout`, or **Sign out** in the Web App | Immediately: the row is deleted |
| One user's sessions | An admin resets that user's password | Immediately: every row for that account is deleted |
| The admin's own sessions | `penguin server reset-admin-password` (server stopped) | At the next start, which prints a fresh first-login link |
| The local API token | Restart the server | At the next start, which writes a fresh token |
| A model API key | Rotate it with the provider, then update the Project config | At the provider |

### If a backup leaks

The design is built around the worst case: **a full backup of the data root leaks**. The response is to rotate the model API keys it contains and to restart the server, and nothing more. Passwords in a backup are scrypt hashes, and the session table holds only the sha256 of each token, never a token.

The one usable credential a backup can hold is the local API token of the server start it was taken from, and a restart replaces it. After that, nothing copied out of the backup can be presented to the live server.

## How it works

### Sessions

Each cookie carries a 32-byte random token. The session is the `auth_sessions` row keyed by the token's sha256, which holds the account, how the session was established (`via`) and the expiry. Because the row is the session, deleting it revokes the session immediately, and a restart signs nobody out.

A browser session lasts 30 days. Using it a day or more after it was issued or last renewed renews it **in place** for another 30 days: the row's expiry moves, and the cookie value stays the same. The 30 days therefore act as an idle timeout: a session in regular use never expires, and there is never a second copy to chase. Only a session whose own lifetime reaches the renewal window slides, so a one-hour minted token expires after its hour.

Cookies are HttpOnly and SameSite=Lax. They are also Secure when the request really is https, or when a **trusted** proxy says so (`PENGUIN_TRUST_PROXY=1`); by default the `x-forwarded-proto` header is ignored.

### What is on disk

| File | Contains | Kept |
| --- | --- | --- |
| `web.db` | Password **hashes**, session **hashes**, application data | Permanently |
| `<project>/.project_config.toml` | Model API keys, inline, mode 0600 | Until edited |
| `cli-session.json` | One live session token, mode 0600 | Until sign-out or expiry |
| `api-token` | The local API token, mode 0600: admin authority for any request that sends it as a Bearer header | Until the next server start |

Never on disk in usable form: session tokens (only their sha256) and passwords. A chosen password exists only as an scrypt hash, and a seeded one is discarded as soon as it is created.

The local API token is on disk on purpose. Reading it proves access to the data root, which is admin authority already, and each server start replaces it.

Model API keys are the one secret that cannot be reduced further: they must reach the providers verbatim, so they cannot be hashed. They are confined to the Project config, masked in every API response and in the UI, and read in plaintext only at the moment a request is made.

### Network surface

The server binds `127.0.0.1` by default. Exposing it (`HOST=0.0.0.0`) is a deployment decision that belongs behind TLS termination, with the proxy setting `x-forwarded-proto`.

The API answers only under its canonical application host, which keeps user-generated preview content in a different browser origin from the application's cookies.

Two independent layers block cross-site request forgery: the SameSite=Lax cookie, and a Content-Type check that rejects any write request whose content type an HTML form could produce.
