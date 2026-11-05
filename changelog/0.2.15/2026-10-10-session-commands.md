# The CLI's session commands move under `penguin session`, which can also rename a Session

- **Date:** 2026-10-10
- **Type:** feature
- **Scope:** `cli`, `server`, `plugins`, `docs`
- **PR:** [#1013](https://github.com/Prism-Shadow/penguin-harness/pull/1013)
- **Issue:** [#813](https://github.com/Prism-Shadow/penguin-harness/issues/813)
- **Breaking:** yes — `penguin ls`, `penguin logs` and `penguin input` were removed; they are now `penguin session ls`, `penguin session log` and `penguin session input`

[中文版](2026-10-10-session-commands.zh.md)

The CLI gained a `penguin session` group for the commands that act on a Project's Sessions: `ls`, `log` (formerly `logs`), `input`, and a new `rename`. `penguin run --title` names a Session as `run` creates or reuses it. Both rename paths send the existing `PATCH /api/sessions/<id>`, whose title check was tightened. No agent tool was added: an agent renames its Session by running the CLI command.

## Details

- **CLI**: `penguin session ls`, `penguin session log` and `penguin session input` replaced the top-level `ls`, `logs` and `input`, with the same options, defaults and output. The hints that name them (the still-running note, the stream-gap notice, the session-not-found error) were updated.
- **CLI**: `penguin session rename [session_id] -t <title>` sets a Session's title, the same manual rename as the Web App's **Rename chat**. An explicit id wins. Without one, it renames the calling Session (`PENGUIN_SESSION_ID`), and only outside a Session the agent's most recent one, named in a dim `[latest]` line on stderr. `-t/--title` is required, so a missing title is a usage error rather than a rename. `--json` prints `{sessionId, title}`.
- **CLI**: `penguin run --title <title>` renames the Session before the Task starts, on the create and the `--session` paths alike, so a `--background` run is named too. Both commands collapse runs of whitespace and check the 1–120 range before any request, so a bad title leaves no unnamed Session behind.
- **Server**: `PATCH /api/sessions/<id>` stores a title's runs of whitespace, newlines and tabs included, as one space, and answers `400` `invalid_title` to a title with a control character or a bidirectional embedding, override or isolate (U+202A–U+202E, U+2066–U+2069). The Web App's rename uses the same route.
- **Plugins**: the `penguin-orchestration` skill (`agent-development` 2026.10.10.1) and the `company-employee` and `company-hr` skills (`agent-company` 2026.10.10.1) use the new command names. `penguin-orchestration` also describes `session rename` and `run --title`.
- **Docs**: the CLI reference gained a `penguin session` section holding `ls`, `log`, `input` and `rename`, and a `--title` row under `penguin run`. The CLI quickstart and the server API reference were updated.

## Compatibility

- `penguin ls`, `penguin logs` and `penguin input` no longer exist and fail as unknown commands. Scripts call `penguin session ls`, `penguin session log` and `penguin session input` instead; options and output are unchanged.
- The built-in skills in this release use the new names. An agent with an older copy of `agent-development` or `agent-company` installed keeps calling the old names until that plugin is updated to 2026.10.10.1 on the **Plugins** page.
