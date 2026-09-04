# The Docker export can pin the container to one agent

- **Date:** 2026-09-04
- **Type:** feature
- **Scope:** `server`, `cli`, `web`, `docs`

[中文版](2026-09-04-pinned-agent-docker-export.zh.md)

`penguin agent export <id> --kind docker --pin` — a checkbox on the export dialog's Docker
segment, `?kind=docker&pin=1` on the bundle route — packs a container whose server serves that
one agent and refuses every request that would create, import, delete or redefine an agent, to
everyone including the built-in admin. `--pin` on any other kind is an error.

## Details

- **The server mode.** `PENGUIN_PINNED_AGENT=<projectId>/<agentId>` makes the server serve that
  one agent: it is the only one listed, in the only Project that lists any, and a Session on
  anything else is `404`. These answer `403 agent_pinned`: create / import / delete an agent;
  `PUT /config`, `config/kernel-update`, `config/reset`; the four `template-placeholder` routes;
  skill archive install and uninstall; plugin install and hook uninstall; Agent State snapshot
  import; schedule create / update / delete; Project create and delete. A Session whose
  `workspace` resolves inside the pinned agent's `agent_state/` is refused too. `PUT /vault`,
  Memory, Project rename, member management and every read are untouched.
- **New users become members of the pinned Project** instead of receiving
  `<username>-default_project`, which would arrive carrying a second agent.
- **`GET /api/me` carries `pinnedAgent`**, and the Web App drops what the server would refuse:
  the Agents page's Import and Create, each card's delete, the sidebar's Project-create entry,
  and every write control on the agent settings page, with one line under the agent's name
  saying why. A pinned card carries a badge.
- **First boot runs in phases.** Importing an agent is a write through the running server, which
  is exactly what a pinned server refuses, so the entrypoint imports against a short-lived server
  bound to `127.0.0.1` and unreachable from outside the container, optionally seeds the accounts
  in `PENGUIN_USERS` against a pinned one, locks the definition files, and only then execs the
  real server with `PENGUIN_PINNED_AGENT` set.
- **The filesystem lock.** `AGENTS.md`, `system_config.yaml`, `skills/`, `hooks/`, `tools/` and
  `schedule/` become root-owned and unwritable on every boot, and the server runs as the
  unprivileged `node` user — the only thing that stops the agent's own file tools, which the
  route guards never see. `memory/` and `.vault.toml` stay writable.
- **The generated Dockerfile now builds.** `node-pty` publishes prebuilt bindings for macOS and
  Windows only, so on Linux `npm install -g @prismshadow/penguin-cli` falls through to
  `node-gyp rebuild`, which the `node:24-slim` image cannot run: every Docker bundle exported
  before this change failed at that step. Both variants now compile the CLI in a builder stage
  carrying `python3 make g++` and copy the finished npm prefix into the slim runtime.
- **An existing data root started pinned** keeps its other Projects and agents on disk; they are
  simply never listed and never served. There is no migration in either direction.
