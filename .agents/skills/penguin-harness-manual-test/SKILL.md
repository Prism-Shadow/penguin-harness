---
name: penguin-harness-manual-test
description: Use when standing PenguinHarness up to try a change by hand — launching the Web App, the desktop shell, the landing page or the docs site to click through it, screenshot it, or reproduce a report. Covers the four dev entry points and their ports, which data root each writes to, and the four ways a healthy setup looks broken.
---

# Standing PenguinHarness up to test by hand

Node >= 24. `dev:*` runs `dev-prebuild.mjs` first (keeps `pnpm install` current, prebuilds
workspace deps); `pnpm desktop` runs a full `pnpm -r build`, so it is slow to start.

## Entry points

| Command | Open | Data root |
| --- | --- | --- |
| `pnpm dev` | http://localhost:7365 | `~/.penguin/dev-data` |
| `pnpm desktop` | its own window | `~/.penguin/dev-data` |
| `pnpm dev:landing` | http://localhost:7366 | none (static) |
| `pnpm dev:docs` | http://localhost:7367 | none (static) |

Other fixed ports (`packages/core/src/internal/ports.ts`): 7364 installed server, 7368 dev backend,
7369 `pnpm penguin web`. On a shared box, `ss -tln` before assuming one is free; `PORT=` inline
moves it.

The user's installed app, server and CLI all use `~/.penguin/data` — their real Agents, Sessions
and keys. Never point a dev run there. Both surfaces print the root they took (`Data root: …`,
`[shell] dev instance … on data root …`); read it rather than assume.

## Four ways a working setup looks broken

**7368 shows a stale app.** The dev backend also serves `packages/web/dist` — the last
`pnpm -r build`, not what Vite is serving. Screenshot 7365, never 7368.

**`curl` returns 502 but the server is fine.** A shell `http_proxy` routes loopback through the
proxy. Use `curl --noproxy '*'`. Browsers and the server itself are unaffected.

**`/api` on `127.0.0.1` returns 401.** That address is reserved as the Workspace-preview host. Use
`localhost`.

**The server exits 3 saying the data root is in use.** Another instance — usually the user's own
desktop app — holds `<root>/server.lock`. The lock is per root, not per port, so `PORT=` will not
get past it. Use a different root; do not kill their process.

## PENGUIN_HOME

Never export it. `scripts/run-with-env.mjs` applies each `VAR=value` only when unset, so an
exported value silently redirects every dev script — an exported `~/.penguin/data` puts `pnpm dev`
on the user's real data, where the lock is already held. It now names any default the environment
displaced before running, so read that line if it appears.

When you need your own root, prefix the one command:

```sh
PENGUIN_HOME=~/.penguin/dev-data-<topic> pnpm dev
```

Unset it rather than blanking it: `run-with-env` reads empty as unset, but `resolveRoot()` uses
`??` and takes an empty string literally.

## Signing in

A fresh root seeds `admin` with a random `penguin-<4 digits>` password, printed once at startup.
`PENGUIN_SEED_ADMIN_PASSWORD` pins it, which is how the e2e harness logs in.

## Editing while it runs

Changes to `core` or `skills` do not reach a running dev server — web/server consume snapshot
copies that re-sync only when that package's `build` runs. Restart `pnpm dev`.

## When you are done

Stop what you started. Leave anything the user was already running alone.
