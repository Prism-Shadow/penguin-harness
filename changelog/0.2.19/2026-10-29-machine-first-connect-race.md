# A first connect to a just-started machine no longer fails with "no such account: admin"

- **Date:** 2026-10-29
- **Type:** fix
- **Scope:** `server`, `cli`, `docs`
- **PR:** [#1398](https://github.com/Prism-Shadow/penguin-harness/pull/1398)

[中文版](2026-10-29-machine-first-connect-race.zh.md)

A machine's server binds its port before it boots its platform and seeds the `admin` account, and the connect flow asked that machine's `penguin auth token` for a session the moment its port answered. On a fresh data root the mint could land in between and fail with "no such account: admin" (or "no web.db"), so the sync reported "Config not synced" until someone retried. `penguin auth token` now waits while a live server on the data root has not seeded yet, and mints once the admin lands.

## Details

- The wait applies only while the data root's server lock is live and the database is missing or holds no account at all. It looks again every quarter second and gives up after 20 seconds, with a failure that says the server has not finished starting.
- With no live server, or with accounts present but not the one asked for, the command fails at once with the same message as before. A server that exits during the wait ends it.
- The desktop shell's own sign-in still mints without waiting.
- The CLI docs for `penguin auth token` describe the wait.
