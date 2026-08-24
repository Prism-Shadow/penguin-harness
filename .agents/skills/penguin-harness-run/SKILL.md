---
name: penguin-harness-run
description: Use when launching or driving PenguinHarness locally — starting the Web App, the desktop shell, the landing page or the docs site to see a change working, take a screenshot, or reproduce a report. Covers the four dev entry points and their fixed ports, which data root each one picks, why an inherited PENGUIN_HOME silently wins over the dev default, the loopback name that serves the API, the shell proxy that makes a healthy server look broken, and the one-server-per-data-root lock.
---

# Running PenguinHarness locally

Node must be >= 24. The `dev:*` commands each run `scripts/dev-prebuild.mjs` first, which keeps
`pnpm install` current (stamped by lockfile hash) and prebuilds the workspace deps (skills, core)
behind a lock that serializes concurrent invocations; `pnpm desktop` runs a full `pnpm -r build`
instead. Read `penguin-harness-dev` for the repo-wide contract and `penguin-harness-frontend` for
Web App conventions.

## The four entry points

| Command | Starts | Open |
| --- | --- | --- |
| `pnpm dev` | dev backend + Web App, under `concurrently` with prefixed logs | http://localhost:7365 |
| `pnpm desktop` | `pnpm -r build`, then the Electron shell from source | its own window |
| `pnpm dev:landing` | the landing site (Vite) | http://localhost:7366 |
| `pnpm dev:docs` | the docs site (Vite) | http://localhost:7367 |

`pnpm dev` is `dev:server` + `dev:web`. The Web App is the surface you open; its `/api` is proxied
to the dev backend on 7368 (`PORT` moves the backend and the proxy target together;
`PENGUIN_API_PROXY` replaces the target outright).

**Do not open the backend port to look at the UI.** 7368 also serves `packages/web/dist` whenever
that directory exists — the last `pnpm -r build` output, not what Vite is serving. It looks like the
app and it is stale. 7365 is the Web App.

Ports are fixed, and the allocation table lives in `packages/core/src/internal/ports.ts`: 7364
installed server, 7365 dev web, 7366 landing, 7367 docs, 7368 dev backend, 7369 `pnpm penguin web`.
The dev backend deliberately does not share 7364 with an installed server, which is routinely
running at the same time. On a box shared with other agents, probe with `ss -tln` before assuming a
port is free and pass `PORT=` inline when it is not.

Editing `core` or `skills` while a dev server runs does not reach it: the workspace uses injected
dependencies, so web/server consume snapshot copies that re-sync only when the package's `build`
runs through pnpm. Restart `pnpm dev`.

## Know which data root you are about to write to

`resolveRoot()` (`packages/core/src/state/paths.ts`) is `PENGUIN_HOME ?? ~/.penguin/data`.
`desktopDataRoot()` (`packages/desktop/src/app-identity.ts`) layers the desktop rule on top: an
explicit `PENGUIN_HOME` always wins; **a packaged (release) build falls through to `resolveRoot()`
— `~/.penguin/data`, shared with the CLI by design**; only an unpackaged run takes
`~/.penguin/dev-data`.

| Entry point | Root when `PENGUIN_HOME` is unset |
| --- | --- |
| `pnpm dev`, `pnpm dev:server`, `pnpm penguin …` | `~/.penguin/dev-data` (the script default) |
| `pnpm desktop` | `~/.penguin/dev-data`, twice over: the script default, and the unpackaged rule |
| `pnpm --dir packages/desktop start` | `~/.penguin/dev-data` (the unpackaged rule alone) |
| the user's installed desktop app, installed server, or installed `penguin` CLI | `~/.penguin/data` — their real Agents, Sessions and keys |

`pnpm desktop` reaches `dev-data` by two mechanisms agreeing, and they are not redundant: the
script default covers every root dev entry point, while the unpackaged rule covers a desktop launch
that never goes through it (`pnpm --dir packages/desktop start`), which would otherwise fall through
to `resolveRoot()` and land on the release install's data. Removing either leaves a hole.

`pnpm dev:landing` and `pnpm dev:docs` are static sites and touch no data root at all.

Both surfaces say which root they took: a server prints `Data root: <root>` under its start banner,
and an unpackaged desktop run prints `[shell] dev instance '<name>' on data root <root>`. Read the
line instead of assuming.

## Never export PENGUIN_HOME

`scripts/run-with-env.mjs` applies each `VAR=value` **only when the variable is unset or empty** —
`${VAR:-value}`, spelled in JS because `cmd.exe` cannot parse it. Every dev default in the table
above comes from that script, so each is a default, not an assignment: an inherited `PENGUIN_HOME`
silently wins and `pnpm dev` resolves to whatever the shell had.

The failure is obvious afterwards and invisible before. With `PENGUIN_HOME=~/.penguin/data`
exported, `pnpm dev` targets the release/CLI root — the one the user's own desktop app is holding —
and either refuses to start (below) or, if that app is idle, writes into their real data.

So: **never export it.** When you need a root of your own, prefix the one command:

```sh
PENGUIN_HOME=~/.penguin/dev-data-<topic> pnpm dev
```

An inline value is already set, so `run-with-env` leaves it alone. Unset the variable rather than
blanking it: `run-with-env` reads empty as unset and substitutes the default, but `resolveRoot()`
and `desktopDataRoot()` use `??`, so anything started without that script (a bare
`node packages/server/dist/index.js`, `pnpm --dir packages/desktop start`) takes an exported-empty
value literally and resolves the root to `""`.

## One server per data root

`<root>/server.lock` records `{pid, port, startedAt}`, and a lock counts as live only when the pid
is alive **and** its port accepts a TCP connection — so a crashed server's leftover is stale and the
next start overwrites it. A live one makes a second server refuse before it opens the database:

```
Another PenguinHarness server is already running on this data root (pid <pid>).
Existing instance: http://localhost:<port>/
```

and exit 3. **A different `PORT` does not help** — the lock is per root, not per port. What holds it
is usually the user's own desktop app or installed server, so do not kill it; start on a distinct
root instead (`PENGUIN_HOME=~/.penguin/dev-data-<topic> pnpm dev`), and the two run side by side.
The CLI and the desktop shell pre-check the same lock and attach to the running instance rather than
failing.

## The API answers on `localhost`, not `127.0.0.1`

On a loopback bind the server canonicalizes the App onto `localhost` and reserves the counterpart
`127.0.0.1` as the Workspace-preview host: there `/api/*` answers `401 unauthorized`, "The API is
not served on the preview host.", and every other path 302s back to `localhost`. The guard reads the
`Host` header — which is why the Vite proxy keeps `changeOrigin: false` and works while a direct
`curl` to the same address does not. The Vite ports compound it from the other side: Vite binds the
name `localhost`, which on an IPv6-enabled box is `::1` only, so `127.0.0.1:7365` is refused
outright.

Address every local surface by name — `curl http://localhost:7368/…`. A 401 from `127.0.0.1` is the
guard, not your session. (`PENGUIN_PREVIEW_ORIGIN` disables the guard; unset is the norm locally.)

## A shell proxy makes a healthy server look broken

`http_proxy` / `https_proxy` in the environment — a `127.0.0.1:7890` style local proxy is the common
case — send even loopback requests through the proxy, so `curl http://localhost:7365/` comes back
502, or as a connection error, while the server is perfectly fine. Nothing else is affected:
browsers bypass loopback themselves, and the server always merges `localhost,127.0.0.1,::1` into its
own effective `NO_PROXY` (`packages/server/src/net/proxy.ts`). **Suspect this before debugging the
server.**

```sh
curl --noproxy '*' http://localhost:7365/                     # per call
NO_PROXY=localhost,127.0.0.1,::1 curl http://localhost:7365/  # per call, same effect
```

## Signing in

A fresh root seeds the `admin` user and prints a framed notice — `Web sign-in: admin /
penguin-<4 digits>` — and keeps the plaintext in `<root>/initial-admin-password` for as long as it
is still the initial password, so every later start reprints it. When scripting a run, pin it
instead of scraping logs: `PENGUIN_SEED_ADMIN_PASSWORD=<value>`, honoured at seed time only. The
desktop shell never prints one; it signs in with a one-shot token.

A fresh root carries the catalog's model presets but no credential of its own, so a chat turn needs
one: a preset resolves `<PREFIX>_API_KEY` / `<PREFIX>_BASE_URL` from the environment
(`resolveModelEnv`), and the server loads the repo's `.env` at startup — `.env.example` lists the
names. To exercise chat flows without any key, drive the Playwright harness in `packages/web/e2e/`
— its `run.sh` starts the mock LLM, a server on a temp root, and a pinned admin password.

## When you are done

Stop what you started. A dev server left running holds its root's lock and its port against the next
run, yours or another agent's on the same box.
