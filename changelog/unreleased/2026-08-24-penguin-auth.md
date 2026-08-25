# `penguin auth` — sign in to a server from a terminal

- **Date:** 2026-08-24
- **Type:** feature
- **Scope:** `cli`, `server`, `docs`

[中文版](2026-08-24-penguin-auth.zh.md)

There was no way to sign in to a PenguinHarness server from a terminal. Everything the CLI does
works on the data root directly — `config`, `run` and `chat` all open files, never a socket — so
nothing in it had ever needed to be a client, and "log in" had no answer beyond the browser's
login page.

```bash
penguin auth login                      # password, against the server on this data root
penguin auth login --server https://penguin.example --user-id alice
penguin auth status
penguin auth logout
penguin auth token                      # no password: minted from this data root
```

## Two ways in

`login` takes a password and asks a running server, exactly as the login page does. The target
defaults to the server running on this data root, read from its lock file, so signing in to your
own needs no URL. Run interactively it asks for the account first and then names it in the
password prompt, so one account's password is never typed at another's; supply the password
non-interactively and neither question is asked, because that is a script and a script cannot
answer one.

`token` takes no password at all. It mints a session straight from the data root, and what
authorizes it is being able to read that root — which already holds every credential the token
could reach. It is for where there is no password to give: a machine whose admin password
somebody set by hand, or a script that must not carry one.

## Sessions are signed statements now

Auth runs on every request, so it is the hottest path in the server. A session used to be a
database row — one read per request, one write per issue and renewal. It is now a signed token
(`v1.<claims>.<hmac>`, keyed by `<root>/auth-token-secret`): issuance and verification are pure
CPU, and the database records only the exceptions — a logout before expiry lands in a small
revocation list that lives in memory after boot and is swept of expired rows at boot and on each
login. Minting from the CLI touches no database at all, so it also works on a root whose server
is down or has never run.

What the row model guaranteed still holds, by other means: logout is a real revocation that
survives restarts (the denylist row); an admin password reset still kills a user's outstanding
sessions (a per-user not-before mark, since there are no rows to delete); sessions issued before
the switch keep working from their rows until they expire; and long sessions still slide, now as
a replacement cookie instead of a row update. Claims record `v: "cli"`, and nothing grants
privilege from it — anything that is not `desktop` reads as an ordinary password session, so a
minted token can never reach the desktop-only routes.

The trade, stated plainly: the signing key can mint sessions for as long as it exists, so a
leaked backup of the data root becomes the ability to forge tokens — where a leaked session row
was just hashes — and issuance itself leaves no audit trail. Rotation is deleting the key file
and restarting, which kills every outstanding token at once.

## Notes

- The session is written to `<root>/cli-session.json` at mode 0600, re-applied on overwrite: the
  `mode` write option only applies at creation, so without it a re-login would quietly downgrade
  a token to world-readable.
- `logout` tells the server first, so the session is revoked there rather than merely forgotten
  here, and clears the local file either way when the server cannot be reached.
- Prefer `PENGUIN_PASSWORD` or the prompt over `--password`: a command line is world-readable
  through `ps`.
