# Unreleased

Changes since v0.1.4. The version number is assigned at release, when this folder is renamed.

- [2026-07-28] Web App and CLI: duration and byte abbreviations now carry into the next unit instead of printing `1m60s` or `1024KB` — both helpers rounded the value they displayed but chose the unit (or the minute/second split) from the raw input. ([details](2026-07-28-duration-and-byte-formatting.md))
- [2026-07-29] Tooling: Agent-spawned commands no longer inherit PenguinHarness-owned server variables such as `PORT` / `HOST`, while the development backend moves off the installed server's default port and the Web dev proxy follows that backend. ([details](2026-07-29-harness-env-and-dev-ports.md))
- [2026-07-29] Web App: the composer can attach files of any type — written to the Session scratchpad and handed to the model as `[attached file: <path>]` lines, keeping non-ASCII names — and the `@` mention becomes an `/agent` command, with `/agent` and `/model` both staging their pick as a chip until Enter sends. ([details](2026-07-29-composer-attachments-and-switch-commands.md))
- [2026-07-29] Core: the default system prompt is about a quarter shorter in the sections re-read every turn, now pins replies to the user's language, states the API-key stop rule once, points at parallel subagents for large tasks, and has skills install their dependencies once into a shared per-Agent `env/` directory. Existing Agents keep their own prompt. ([details](2026-07-29-default-system-prompt.md))
