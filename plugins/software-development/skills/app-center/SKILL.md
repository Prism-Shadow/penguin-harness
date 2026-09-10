---
name: app-center
description: Register a runnable app built in this Session with the App Center — run it in the background on a stable port, verify it answers, then `penguin app register` with its URL and start/stop commands — keep the entry current, and carry out the App Center's restart / stop requests.
---

# App Center

The App Center is the Web App page that lists the apps built in this Project's conversations, each with its live status and a restart / stop button. An app is registered **from the Session that built it**: that Session is where the App Center sends its restart and stop requests, so the registration carries what those requests need — the URL the app serves at, and the commands that start and stop it.

## Before you start

Use this skill once you have built a runnable application in this Session — a web app, an API server, a dashboard, a tool that serves something over HTTP — and it works. If the user's message only invokes this skill without an app to register, ask what to register (or build it first). Never register something that does not run: the App Center probes the URL and would only list it as stopped.

## Register an app

1. **Run it in the background on a stable port.** Start it with `exec_command` and `run_in_background: true`, on a fixed port you choose (3000, 8000, …) and keep across restarts — never let a dev server pick a random one. Bind to localhost.
2. **Verify it answers** before registering, e.g. `curl -sS -o /dev/null -w '%{http_code}' http://localhost:<port>/` — any HTTP status means the server is up; a refused connection means it is not.
3. **Register it:**

   ```bash
   penguin app register --name "<display name>" --id <slug> \
     --url http://localhost:<port> \
     --start-command "<command that starts it from the Workspace>" \
     --stop-command "<command that stops exactly this app>" \
     --kind web
   ```

   - The owning Session, its agent and its Workspace are filled in from this Session (`PENGUIN_SESSION_ID`); pass `--workspace` only when the app lives in another directory.
   - `--id` is the entry's file name (letters, digits, `_`, `-`); give a stable one — registering the same id again **updates** the entry.
   - `--kind`: `web` (a page the user opens), `api` (an HTTP API), `cli` (a tool without a URL), `other`.
   - `--health-url` when the root URL is not the right probe (a SPA behind a router, an API whose `/health` is the honest answer); `--description` for one line under the name.
4. **Tell the user** the URL and that the app now appears in the App Center.

## Commands that survive a restart

- The start command runs from the Workspace and must keep the app in the background: `npm start`, `node server.js`, `python -m uvicorn app:main --port 8000` — the App Center's restart request asks you to run it with `run_in_background`, so the command itself need not daemonize.
- The stop command must be idempotent and must target only this app: a pid file, or a port-based kill (`fuser -k 3000/tcp`, `lsof -ti :3000 | xargs -r kill`). Never a broad `pkill node`.

## Keep the entry current

- When the port, the URL or the start/stop commands change, run `penguin app register` again with the same `--id`.
- When the app is removed or replaced, run `penguin app unregister <id>`.
- `penguin app ls` lists this Project's apps with their probed status; `penguin app status <id>` probes one now.

## Carry out App Center requests

A user message that starts with an `[app_center]` block is a restart or stop request the user clicked in the App Center. Do exactly what its steps say, with the registered commands: stop the running process (the stop command, or stop the background command you started), for a restart start it again in the background with the start command, wait until the URL answers, then confirm in a sentence or two. Do not redesign or rebuild the app on the way; when a step fails, report why instead of retrying indefinitely.
