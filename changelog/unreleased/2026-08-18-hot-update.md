# Hot update: replace the running harness's code over HTTP, no restart

- **Date:** 2026-08-18
- **Type:** feature
- **Scope:** `server`, `cli`, `web`, `tooling`
- **PR:** [#298](https://github.com/Prism-Shadow/penguin-harness/pull/298)

[中文版](2026-08-18-hot-update.zh.md)

A running PenguinHarness — the desktop app included — can now be updated in place: one
HTTP push replaces the backend platform, the CLI's command implementations, and the Web
App together, in seconds, without restarting the server or reinstalling anything. Live
state survives the swap — a terminal process started before an update is still running,
with its output intact, after it.

## One push, one version

`POST /api/hmr/upgrade` takes a single gzip payload carrying three artifacts — the
platform bundle, the CLI bundle, and the built web dist — and applies them as one atomic
version. The new platform must boot and the web dist must validate before anything is
committed; a failure of either leaves the previous version running untouched. A restart
resumes the last committed version as a unit, and a damaged store falls back to the
packaged defaults rather than a broken half-update. The store keeps the current version
plus one rollback candidate.

Deploying is one command: `PENGUIN_ADMIN_PASSWORD=… node scripts/deploy.mjs <port|url>`
builds and pushes everything, working equally through an ssh tunnel to a remote machine.

## Pushed code owns its API

The runtime no longer owns the route table. Every request is offered to the running
platform first, so a push can add an endpoint, replace one, or change what an existing
one does — with no rebuild and no new server release. Only the `/api/hmr/*` upgrade
channel is reserved: it is what a broken platform gets replaced through, so no push can
take it away.

## The CLI updates with the push

`penguin` runs the CLI implementation most recently pushed to the machine, straight from
the update store, falling back to the one built into the binary when nothing has been
pushed — so command fixes ship with the same push as the server code they talk to, without
reinstalling the binary. `penguin-hmr` is the strict form, erroring rather than falling
back, for checking that a push arrived. A pushed bundle that cannot be loaded is a warning,
not a failure, and `PENGUIN_NO_HMR=1` runs the built-in implementation without looking.

## Access

The hot APIs require an admin session (the same login as the browser) and are
loopback-only unless served over HTTPS — there is deliberately no token on disk and no
insecure-network override: a file credential would be readable by everything running as
the same user, including an agent's own shell.
