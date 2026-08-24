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
somebody set by hand, or a script that must not carry one. A token expires within the hour and is
one row to revoke, which a password read off disk is not.

The row records `via: "cli"`. Nothing grants privilege from it — anything that is not `desktop`
reads as an ordinary password session, so a token minted this way can never reach the
desktop-only routes — but the table tells the truth about where a session came from.

## Notes

- The session is written to `<root>/cli-session.json` at mode 0600, re-applied on overwrite: the
  `mode` write option only applies at creation, so without it a re-login would quietly downgrade
  a token to world-readable.
- `logout` tells the server first, so the session is revoked there rather than merely forgotten
  here, and clears the local file either way when the server cannot be reached.
- Prefer `PENGUIN_PASSWORD` or the prompt over `--password`: a command line is world-readable
  through `ps`.
