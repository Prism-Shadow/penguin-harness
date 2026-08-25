# New built-in skill: penguin-orchestration

- **Date:** 2026-08-25
- **Type:** feature
- **Scope:** `skills`, `docs`

[中文版](2026-08-25-penguin-orchestration-skill.zh.md)

Added `penguin-orchestration` (v1) to the skill library's AI App Development group, right after `penguin-cli`. It teaches an agent running inside PenguinHarness to drive the harness itself over the `penguin` CLI against its own local server: list and create agents, start sessions and steer them mid-flight, read transcripts, and query costs and scheduled tasks. The skill documents the server-backed CLI surface introduced on branch `feat/cli-on-server` — the injected `PENGUIN_API_URL` / `PENGUIN_API_TOKEN` / project, agent and session id environment variables inside agent sessions, and the lock-file attach or auto-start path outside — so it ships together with that rework and must merge after it lands.

## Details

- Recipes: summarize yesterday's conversations (session ids embed their creation timestamp, `session-YYYY-MM-DD-HH-mm-ss-<8hex>`), query the last 7 days of cost (`penguin cost --days 7 --by agent` and variants), create an agent and talk to it (`penguin agent create` then `penguin run --agent-id`), inspect scheduled tasks (`penguin schedule ls`) and create one by writing a schedule TOML with file tools, and run a CLI-driven conversation in the background — `exec_command` with `run_in_background` for a completion report, or `penguin run --background` for a server-side run that survives the caller — steering it mid-flight with `penguin input <session_id> -m ... --no-wait`.
- Cautions cover the one-active-task-per-session rule, approval modes for unattended sessions (`allow-all` / `read-only`; `always-ask` hangs), runaway self-messaging loops, project-level cost attribution, and the standing ban on hand-editing `.project_config.toml` / `.vault.toml`.
- Registered in `SKILL_GROUPS`, the package README table and the bilingual docs skill tables; hand-drawn `icon.svg` (a conductor node fanning out to two nodes). No `preinstall` marker, so new `default_agent`s get it like the rest of the library.
