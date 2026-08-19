# Web App: per-Project defaults for new chats

- **Date:** 2026-08-04
- **Type:** feature
- **Scope:** `web`, `server`
- **PR:** [#191](https://github.com/Prism-Shadow/penguin-harness/pull/191)

[中文版](2026-08-04-project-chat-defaults.zh.md)

Project settings gains a "New chat defaults" section (owner-editable; members see it read-only; placed below Members, laid out as a compact two-column grid): the default Agent, working directory (empty means the auto temp dir), approval mode and thinking level applied when a chat is created. The workspace and model controls are the composer's own pickers — the draft view's directory browser and the chat input's model picker were extracted into shared components (`workspace-select.tsx`, `model-select.tsx`) and both original surfaces refactored onto them, so the settings dialog and the composer render one implementation. In the dialog they wear a `form` trigger variant styled with the dialog's own field tokens (the composer keeps its pill triggers byte-for-byte), their menus paint above the modal, and the modal's private Escape stack was generalized into a shared esc-layer stack so Escape closes the topmost thing first — menu, then dialog. The values live in an optional `[default_chat]` table in `.project_config.toml` — `agent_id`, `workspace`, `approval_mode`, `thinking_level` — served by a member `GET` and owner `PUT /api/projects/:p/chat-defaults`; the PUT is a declarative whole-block replace (an omitted key clears it), rejects unknown agents and invalid enum values, and read-modify-writes the TOML so models and credentials are untouched.

The draft view seeds from these beneath anything more specific: route state (e.g. "New Chat" from an agent row) beats an unsent draft, which beats the project default, which beats the previous hardcoded fallbacks. The model row deliberately adds no new key: it renders and writes the same top-level `default_model` the models page owns, through a narrow owner `PUT /api/projects/:p/models/default` that validates membership in the models table, and changing it releases any draft-pinned model exactly as the models page does (the two surfaces now share that helper).

Thinking level resolves as: the Agent's explicit `model.thinking_level`, else the project default, else `medium`. The draft picker shows the effective value, and a pick still writes the Agent's own config — the project value is only ever a fallback. One deliberate behavior change rides on this: an Agent config with no explicit level now follows the project default where it previously always meant the built-in default.

The block is additive — configs without it behave exactly as before and no migration runs. One version-skew caveat: an older penguin CLI (0.2.0 and earlier) rewriting a project config drops the block, since its loader rebuilds a known-keys literal; the current code round-trips it. The TOML renderer also learned to emit table-valued keys after scalar keys, so a later scalar append (say, a rename on a config that lacked `name`) can no longer be parsed into a preceding table.
