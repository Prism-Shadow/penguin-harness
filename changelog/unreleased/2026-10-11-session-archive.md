# The sidebar lists active conversations only, and archived chats move to Settings

- **Date:** 2026-10-11
- **Type:** feature
- **Scope:** `server`, `web`, `cli`, `docs`

[中文版](2026-10-11-session-archive.zh.md)

The sidebar's Background and Archived folders are gone. A Session is archived when the user archived it, or when a program opened it (the Agent API, a scheduled task's new-Session run, `penguin run`) and the user has not kept it; every other conversation is active and listed in the sidebar. Archived conversations live on a new Settings page, **Archived chats**, where they can be searched, filtered, unarchived and deleted in batches. Subagent Sessions are opened only from their parent's Agent panel.

## Details

- **Server**: the listing rule is computed on every read. `sessions` gains a nullable `kept_at` column (schema migration 15): unarchiving writes it and archiving clears it, and a run never touches it, so a background Session the user unarchived stays in the sidebar through later runs. `SessionInfo.archived` is the rule's answer. Existing api, schedule and cli Sessions read as archived from this version on; nothing on disk is rewritten.
- **Server**: `SessionCategory` is `active` or `archived`; `?category=background` is a 400. `subagent` and `company` Sessions are in no category and in no total, in the Session list and in the paged Agent Traces listing.
- **Server**: `PATCH /api/sessions/:id {archived}` answers `409 session_not_listed` for a `subagent` or `company` Session and announces `session_archived` to the Project's users. `DELETE /api/sessions/:id` also deletes the Session's subagent children, found from the `subagent` pointer records of its Trace, and announces `session_deleted` for each Session it removes.
- **Server**: four routes under the current user: `GET /api/me/archived-sessions/groups` (groups by Workspace under Project, with counts), `GET /api/me/archived-sessions` (one group's rows, newest activity first, by cursor), `POST /api/me/archived-sessions/unarchive` and `POST /api/me/archived-sessions/delete` (explicit ids, up to 500, or a filter). They cover every Project the user owns or is a member of, and accept a title query and a source filter (`user`, `api`, `schedule`, `cli`).
- **Web**: the sidebar fetches active rows only and forms its Workspace groups from active counts; folder-only groups are gone. A program's Session the user kept shows its source glyph. The row menu keeps **Archive**.
- **Web**: **Settings › Personal › Archived chats** groups archived conversations by Workspace under Project, newest first, each group with its count and a menu to unarchive or delete it whole. Rows show the title, the time, the source and a running mark, with a delete icon and **Unarchive**; rows can be chosen for a batch. Every delete asks first. The page follows changes made elsewhere as they happen.
- **Web**: the URL of an archived conversation shows a stub with its title, time and source, **Unarchive** and a delete icon, instead of the transcript; unarchiving loads the conversation in place.
- **Web**: archived Sessions raise no completion notifications, and a Session a program opens no longer makes the sidebar reload.
- **CLI**: `penguin session ls` hides the Sessions `penguin run` created, which are archived by rule; `-a` lists them.
- **Docs**: the chat, settings, server API, Agent API, CLI, evaluation and self-improvement pages describe the archive.

Sessions that programs opened before this version are listed on the **Archived chats** page; unarchiving one keeps it in the sidebar from then on.
