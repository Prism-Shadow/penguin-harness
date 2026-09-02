# The App Center: apps built in conversations, registered, probed and controlled from one page

- **Date:** 2026-09-02
- **Type:** feature
- **Scope:** `server`, `web`, `cli`, `core`, `skills`, `docs`

[中文版](2026-09-02-app-center.zh.md)

An app built in a conversation can now be published to the App Center — a page below Agents that lists every registered app with its live status and a restart / stop button each. Each app is bound to the Session that built it: the `app-center` skill (new in the `software-development` plugin) has the agent run a finished app in the background on a stable port, verify it answers and register it through the new `penguin app` CLI, and the restart / stop buttons send their request back to that Session, where the agent carries it out.

## Details

- Server: a Project-level registry of `<project>/apps/<id>.toml` files (the file is the truth, the API a validated writer; nothing in SQLite) behind `GET|POST /api/projects/:p/apps`, `GET|PUT|DELETE …/apps/:id` and `POST …/apps/:id/actions`. Status is probed from the app's health URL — any HTTP response is running, a refused connection or a timeout stopped, no URL unknown — cached per URL for ten seconds and re-probed on `?refresh=1`. An action composes an `[app_center]` origin block plus instructions and hands it to the owning Session as a new Task, a queued follow-up, or steering into the running Task; a deleted Session answers 409 `app_session_missing`. Any member reads and sends actions; registering, editing and unregistering are owner-only, like schedules.
- Core: the `[app_center]` marker joined the origin blocks (builder, parser, title-noise list).
- CLI: `penguin app ls | register | unregister | status`. `register` binds the app to `PENGUIN_SESSION_ID` by default, lets the server fill the agent and Workspace from that Session, and updates an existing `--id` in place.
- Skill: `app-center` in `software-development` (manifest version `2026-09-02.2`) — run the app in the background on a stable port, verify it, register it with its URL and start / stop commands, keep the entry current, and carry out `[app_center]` requests.
- Web: the App Center page (`/apps`, between Agents and the plugin library in the nav and the collapsed rail): a search box, a status segment, rows with a kind glyph, a meta line and a status pill, Open / Restart / Stop, a menu with go-to-session / edit / unregister, a re-probe every 20 seconds, and the kit's split "New app" button — Create with AI on the Project's default agent with the app-building tail, or a manual form against one of the Project's recent Sessions. The chat folds an `[app_center]` block into a one-line "App Center: restart …" notice, and input history skips such messages.
- Docs: the Web App, CLI, Server API and Skills pages describe the page, the command family and the endpoints in both languages.
