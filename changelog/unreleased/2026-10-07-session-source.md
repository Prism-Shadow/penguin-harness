# A Session's source is always recorded, and the sidebar keeps every background conversation in one folder

- **Date:** 2026-10-07
- **Type:** feature
- **Scope:** `core`, `server`, `web`, `cli`, `docs`
- **PR:** [#999](https://github.com/Prism-Shadow/penguin-harness/pull/999)

[中文版](2026-10-07-session-source.zh.md)

Every Session's `session_meta` recorded what kind of conversation it was, in a required `source`: `user` for a person's conversation, `schedule` for a scheduled task's run, `subagent` for a `run_subagent` child, `cli` for one `penguin run` created, and `api`, reserved for the Sessions the Agent API opens. `benchmark` was retired. The sidebar's Subagents, Scheduled and Evaluations folders were merged into one **Background** folder that holds every Session that is not a person's, each row marked with its source. How Traces written before this change are read is recorded in [backward compatibility](2026-10-07-backward-compatibility.md).

## Details

- Core recorded `source: "user"` when `createSession` was given none, and carried a resumed Session's source into every context it opened. `SessionSource` was defined once in core's OmniMessage types, and `normalizeSessionSource` narrowed a value read back from a Trace or a forwarded meta.
- Company mode's desk and ticket Sessions, the Web App composer's conversations, forks and `penguin chat` were `user`; the server's `client` column, which program created the row, stayed a separate fact, so a desk remained `client: "org"`. A fork's Trace head recorded `user` whatever the Session it was cut from.
- `penguin run` created every Session as `cli`, the Test Sessions the agent-evaluation skill launches included, and the skill no longer passed `--source benchmark`. The flag left the help.
- The sessions list's and the Agent Trace listing's `category` took `active`, `background` and `archived`, and `counts=1` returned those three totals: archived first, then `active` for a `user` Session or one not yet classified, `background` for every other source. On creation, `source` accepted `"cli"` only; `api`, `schedule`, `subagent` and `user` were refused with a 400. `session_created` always carried the new Session's source.
- The Web App's sidebar drew one Background folder below each group's active conversations (and one shared set in time grouping), loaded and paged per Agent and category like the other folders. Each of its rows carried a source mark with a tooltip: a plug for API, a calendar for Scheduled, two robots for Subagent, a `>_` prompt for CLI. The alarm clock kept marking a conversation with a scheduled task still to fire.
- **Last conversation**, the chat page's auto-select and the jump after deleting the open conversation picked only a person's conversations, so a scheduled run no longer qualified.
- The Evaluation Center's **Use** dialog stopped marking the conversation it composed: the evaluation conversation was an ordinary one, and the draft cache no longer kept the mark.
- The gallery's mock list route and fixtures followed the three categories.
