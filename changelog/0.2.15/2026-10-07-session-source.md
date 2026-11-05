# A Session's source is always recorded, and the sidebar keeps every background conversation in one folder

- **Date:** 2026-10-07
- **Type:** feature
- **Scope:** `core`, `server`, `web`, `cli`, `docs`
- **PR:** [#999](https://github.com/Prism-Shadow/penguin-harness/pull/999)

[中文版](2026-10-07-session-source.zh.md)

Every Session's `session_meta` recorded what kind of conversation it was, in a required `source`: `user` for a person's conversation, `schedule` for a scheduled task's run, `subagent` for a `run_subagent` child, `cli` for one `penguin run` created, `company` for company mode's desk and ticket Sessions, and `api`, reserved for the Sessions the Agent API opens. `benchmark` was retired. The sidebar's Subagents, Scheduled and Evaluations folders were merged into one **Background** folder that holds the Sessions a program opened, each row marked with its source; company Sessions were left out of the session list altogether. How Traces written before this change are read is recorded in [backward compatibility](2026-10-07-backward-compatibility.md).

## Details

- Core recorded `source: "user"` when `createSession` was given none, and carried a resumed Session's source into every context it opened. `SessionSource` was defined once in core's OmniMessage types, and `normalizeSessionSource` narrowed a value read back from a Trace or a forwarded meta.
- The Web App composer's conversations, forks and `penguin chat` were `user`; the server's `client` column, which program created the row, stayed a separate fact. A fork's Trace head recorded `user` whatever the Session it was cut from.
- Company mode's organization runtime opened its desk and ticket Sessions as `company`, still stamped `client: "org"`; the children they spawn stayed `subagent`. A desk opened at a hire that had not run when the server restarted was rebuilt as `company` for its first run, and the list read such a row as `company` meanwhile.
- `penguin run` created every Session as `cli`, the Test Sessions the agent-evaluation skill launches included, and the skill no longer passed `--source benchmark`. The flag left the help.
- The sessions list's and the Agent Trace listing's `category` took `active`, `background` and `archived`, and `counts=1` returned those three totals: archived first, then `active` for a `user` Session or one not yet classified, `background` for `api`, `schedule`, `subagent` and `cli`. A `company` Session belonged to no category, archived or not: a list asked for a category, a Workspace group or counts left it out of the page, the totals, the per-Workspace totals and their stamps, and the paged Agent Trace listing left it out too; the plain list still served it, and company mode's own sessions route listed desks and tickets as before. `excludeOrg` stayed, since it also drops the children of company Sessions and the rows an organization names before its next pass stamps them. On creation, `source` accepted `"cli"` only; `api`, `schedule`, `subagent`, `company` and `user` were refused with a 400. `session_created` always carried the new Session's source.
- The Web App's sidebar drew one Background folder below each group's active conversations (and one shared set in time grouping), loaded and paged per Agent and category like the other folders. Each of its rows carried a source mark with a tooltip: a plug for API, a calendar for Scheduled, two robots for Subagent, a `>_` prompt for CLI. The alarm clock kept marking a conversation with a scheduled task still to fire.
- **Last conversation**, the chat page's auto-select and the jump after deleting the open conversation picked only a person's conversations, so a scheduled run no longer qualified, and a company Session never did.
- The Evaluation Center's **Use** dialog stopped marking the conversation it composed: the evaluation conversation was an ordinary one, and the draft cache no longer kept the mark. This replaced the rule of [The Evaluations folder holds only the Test Sessions an agent starts](2026-10-04-evaluation-tasks-list.md), which kept `benchmark` for those Test Sessions: they became `cli` Sessions in the Background folder.
- The gallery's mock list route and fixtures followed the three categories, and its company desk fixture became a `company` Session that no category lists.
