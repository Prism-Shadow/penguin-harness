# The sidebar lists active conversations only, and archived chats move to Settings

- **Date:** 2026-10-11
- **Type:** feature
- **Scope:** `server`, `web`, `cli`, `docs`, `skills`
- **PR:** [#1032](https://github.com/Prism-Shadow/penguin-harness/pull/1032)
- **Breaking:** yes — the Session list's `category=background` now answers 400; ask for `category=archived`

[中文版](2026-10-11-session-archive.zh.md)

The sidebar's Background and Archived folders are gone. A Session is archived when the user archived it, or when a program opened it (the Agent API, a scheduled task's new-Session run, `penguin run`) and the user has not kept it; every other conversation is active and listed in the sidebar. Archived conversations live on a new Settings page, **Archived chats**, where they can be searched, filtered, unarchived and deleted in batches. Subagent Sessions are opened only from their parent's Agent panel.

## Details

- **Server**: the listing rule is computed on every read. `sessions` gains a nullable `kept_at` column (schema migration 16, `sessions-kept-at`): unarchiving writes it and archiving clears it, and a run never touches it, so a background Session the user unarchived stays in the sidebar through later runs. `SessionInfo.archived` is the rule's answer. Existing api, schedule and cli Sessions read as archived from this version on; nothing on disk is rewritten.
- **Server**: `SessionCategory` is `active` or `archived`; `?category=background` is a 400. `subagent` and `company` Sessions are in no category and in no total, in the Session list and in the paged Agent Traces listing.
- **Server**: `PATCH /api/sessions/:id {archived}` answers `409 session_not_listed` for a `subagent` or `company` Session and announces `session_archived` to the Project's users. `DELETE /api/sessions/:id` also deletes the subagent Sessions the Session spawned, found from the `subagent` pointer records of its Trace (a fork leaves alone the ones its copied history names: they are its source's), and announces `session_deleted` for each Session it removes.
- **Server**: four routes under the current user: `GET /api/me/archived-sessions/groups` (groups by Workspace under Project, with counts and the time they were taken, `asOf`), `GET /api/me/archived-sessions` (one group's rows, newest activity first, by cursor), `POST /api/me/archived-sessions/unarchive` and `POST /api/me/archived-sessions/delete` (explicit ids, up to 500, or a filter). They cover every Project the user owns or is a member of, and accept a title query and a source filter (`user`, `api`, `schedule`, `cli`). A filter may carry `until`, a groups `asOf`: it then acts only on the Sessions archived by that time and not active since; `exclude` leaves named Sessions out. A filter's delete leaves a running Session alone; named by id, a running Session is aborted and deleted.
- **Server**: with `counts=1` the Session list adds `workspaceLatestActive`, each Workspace's newest active Session, beside `workspaceLatest`, its newest Session of any kind.
- **Web**: the sidebar fetches active rows only and forms and orders its Workspace groups from active Sessions only; an archived run no longer moves a group up. Folder-only groups are gone. A program's Session the user kept shows its source glyph. The row menu keeps **Archive**, except on a connected machine's rows, which the archive page cannot list yet. The Workspace picker's **Recently used** still counts every Session.
- **Web**: **Settings › Personal › Archived chats** groups archived conversations by Workspace under Project, newest first, each group with its count and **Select all**, which chooses every Session of the group, loaded or not (**Deselect all** once all of it is chosen); unticking a row afterwards keeps the rest chosen. One batch bar at the top acts on whatever is chosen. What Select all chose covers the Sessions its count saw: one archived, opened or run after the count is left alone, and a delete leaves a running one alone. Rows show the title, the time, the source as a text pill (**API**, **CLI**, **Scheduled**; none on a person's conversation) and a running mark, with a delete icon and **Unarchive**; a row's box shows on hover or keyboard focus. Every delete asks first. The page follows changes made elsewhere as they happen.
- **Web**: archiving the conversation on screen goes to New chat. The URL of an archived conversation, opened later, shows a stub with its title, time and source pill, **Unarchive** and a delete icon, instead of the transcript; unarchiving loads the conversation in place.
- **Web**: only the sidebar's conversations raise completion notifications (not archived, subagent or organization Sessions), and a Session a program opens no longer makes the sidebar reload.
- **CLI**: `penguin session ls` hides the Sessions `penguin run` created, which are archived by rule; `-a` lists them.
- **Docs**: the chat, settings, server API, Agent API, CLI, evaluation and self-improvement pages describe the archive.
- **Skills**: `agent-evaluation`, `agent-initialization` and `penguin-sdk` say where a program's conversations are now (**Settings › Archived chats**), with new versions.

Sessions that programs opened before this version are listed on the **Archived chats** page; unarchiving one keeps it in the sidebar from then on.

## Compatibility

`category=background` on `GET /api/projects/:projectId/agents/:agentId/sessions` and on the paged `GET /api/projects/:projectId/agents/:agentId/traces` now answers `400`. Ask for `category=archived` instead: it holds the API, scheduled-task and `penguin run` Sessions nobody kept, besides the ones archived by hand. Subagent Sessions are in no category; the list without `category` still serves them.
