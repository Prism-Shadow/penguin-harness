# Sessions can be renamed from the CLI and from inside a Session

- **Date:** 2026-10-09
- **Type:** feature
- **Scope:** `core`, `server`, `cli`, `web`, `docs`
- **Issue:** [#813](https://github.com/Prism-Shadow/penguin-harness/issues/813)

[中文版](2026-10-09-session-rename.zh.md)

A Session's title is the label its owner uses to find it and tell it apart from the others, and before this change a program could set it only through the Web App. `penguin session rename <title> [session_id]` renames a Session from the CLI, `penguin run --title <title>` names a Session at the moment `run` creates or reuses it, and the new `rename_session` built-in tool lets a running agent rename its own Session, or another one in the same Project, when asked. All three paths use the existing `PATCH /api/sessions/<id>` endpoint and the same validation.

## Details

- **Core** defined a `SessionControl` service on the Environment, bound per Session from a new `CreateAgentOptions.sessionControl` host callback the way `controlEnv` already is. Subagents inherit it, so a child can rename a Session in the Project it belongs to. The `rename_session` tool takes a required `title` (1–120 characters) and an optional `session_id`; with no `session_id` it renames the Session it runs in. A missing or empty title fails the call, and a rename the host refuses (a target that is not found or belongs to another Project) is reported in the result without failing the call. `rename_session` joined the default built-in tool list, so new agents ship with it; an existing agent picks it up through the kernel update described below.
- **Server** implements the `SessionControl` callback in the session runtime: it resolves the target (`session_id` or the hosting Session), requires the target to belong to the same Project as the Session the tool runs in, validates the title with the same rule the HTTP endpoint uses (1–120 characters after trimming), updates the title in the Session index, and notifies the Project's other users with the existing `session_title` event, so a rename is visible in the Web App the same way a Web App rename is.
- **CLI**: `penguin session` opens with `rename <title> [session_id]`. An explicit session id (full or a unique fragment) always wins; omitted, it is the calling Session (`PENGUIN_SESSION_ID`) when the command runs inside one, and only otherwise the agent's most recent Session, named in a dim `[latest]` line on stderr. The most recent Session can be a different, parallel one, so it is the fallback rather than the default for "rename this chat". `--json` prints `{sessionId, title}`. `penguin run --title <title>` applies the title to the Session before the Task starts, in the create and the `--session` reuse paths alike, so a `--background` run is named too. Both commands check the title (1–120 characters after trimming) before any request, so a bad title never leaves an unnamed Session behind.
- **Web App**: the tool card shows `rename_session` as **Rename** / **重命名** alongside the other built-in aliases.
- **Kernel**: adding a default tool changes the tools tab, so `KERNEL_VERSION` moved to `2026-10-09` with the new tools-tab hash, and the previous one is recorded as superseded. Agents whose tools tab still matches an earlier default pick up `rename_session` on their next kernel update; agents with an edited tool list keep it as written.
- **Docs**: the CLI reference gained a `penguin session` section and a `--title` row under `penguin run`. The tools page's built-in tool count is 8, with a `rename_session` row in the table.
