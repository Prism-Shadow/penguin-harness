# A Session has a surface, and Claude Code is the first one

- **Date:** 2026-09-05
- **Type:** feature
- **Scope:** `core`, `server`, `web`, `plugins`, `tooling`
- **PR:** [#626](https://github.com/Prism-Shadow/penguin-harness/pull/626)

[中文版](2026-09-05-session-surface.zh.md)

The chat page no longer assumes every Session is a conversation. A Session can carry a **surface** — a plugin-contributed kind that decides what the page renders for it and where its idle / running state comes from. The built-in conversation is the absent surface; the first contributed one is `claude-code`, which opens the Claude Code TUI in the Session's Workspace. See PRFC-0009.

## The surface floor

A plugin contributes a surface through the new `SessionSurfacesModule.surfaces` slot: the static half (`kind`, label, renderer) is what `GET /api/contributions` now hands the Web App under `sessionSurfaces`, the code half is a `SessionSurface` the server opens, asks about and closes. Two `kind`s the same is a boot error — the `kind` is written on every Session of that kind. The vocabulary is type-only in `@prismshadow/penguin-core/plugin`; the interface a surface plugin may require (`Terminals`) is on the `@prismshadow/penguin-server/plugin` surface.

A surface Session carries no model reference (`sessions.surface` is a new column, `NULL` for a conversation) and no core Session: the SessionManager never drives it, and every run-shaped call (Task, compaction, steer, approval) answers 409 `surface_session`. Its state is the surface's own, pushed into the SessionManager so `statusOf` — and every list row — answers for it, and published as the same `session_state` event a run's flip is, so the sidebar's running and unread glyphs are unchanged. `POST /api/sessions/:id/surface` opens it (idempotent, an optional first prompt), `GET` reports it, `DELETE` closes it; deleting the Session closes it too.

## The chat page consumes contributions

The Web App now fetches `GET /api/contributions` once per signed-in user. Its `pages` are folded into the router — a page a pushed platform or a plugin contributes mounts as long as this build carries its renderer — and its `sessionSurfaces` become one "New chat" entry each, in the sidebar and the collapsed rail. A surface Session's chat route renders the surface's renderer (`TerminalSurface` attaches the terminal view the dock uses; an `iframe` renderer loads the plugin's own page) instead of the message stream and composer.

A terminal can now run a program instead of a shell: `Terminals.create` takes a `command` (argv, no login shell) and `env`, used by a surface, never exposed over HTTP.

## The claude-code plugin

`@prismshadow/penguin-plugin-claude-code` (`plugins/claude-code`) contributes the `claude-code` surface: a "New chat" entry that runs `claude` (or `PENGUIN_CLAUDE_BIN`) in the Session's Workspace, with the first prompt as its first argument and as the Session title. Its state is a heuristic — output within a window is running, silence is idle, exit is idle — since a pty cannot report thinking. It ships with every build and is listed in the built-in plugin index, but is **not installed by default**: an operator installs it like any other plugin.

## The plugin integration-test framework

`@prismshadow/penguin-plugin-test` (`packages/plugin-test`) starts the real server with a plugin installed, the way `@vscode/test-electron` starts real VS Code: `startHarness({ plugins })` writes a scratch data root's `plugins.json`, runs the server as a child process, and returns a signed-in client (`get` / `post` / …, a terminal helper) plus `stop()`. The plugin is loaded by the real loader, so a test proves the package resolves, loads and boots — not a stand-in of it. The `claude-code` integration test drives the whole surface lifecycle against it with a fake `claude`.
