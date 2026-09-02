# Scheduled tasks in the chat dock, the Session row menu, and the Schedule tab's AI path

- **Date:** 2026-09-02
- **Type:** feature
- **Scope:** `web`, `docs`
- **PR:** [#593](https://github.com/Prism-Shadow/penguin-harness/pull/593)

[中文版](2026-09-02-schedule-panel.zh.md)

Scheduled tasks became reachable from the conversation itself. The chat page's dock gained a **Scheduled tasks** panel listing the tasks bound to the current Session, the Session row menu gained **Schedule a task**, and the Agent settings Schedule tab joined the "Create with AI" pattern — with one twist: from inside a conversation, the AI path sends the request into that conversation rather than opening a new one.

## Details

- A new dock panel kind, `schedules`: the current Session's tasks (an agent's schedules filtered to this Session), a search box and All / Active / Paused / Completed filters, rows with a state glyph, the task name and a plain-language schedule line (`describeSchedule`: "Every day at 08:00 · Next: tomorrow 08:00", "Every Monday at 09:00", "Every 30 minutes", "One-off · Sep 3, 10:00", settled states named up front), an enable switch and an edit / delete menu for owners, and a Suggestions list (daily brief, weekly review, follow-up reminder, update monitor). The list refetches when the tab comes to the front, on window focus, every 30 s while visible, and after every change; the draft page shows what the first message unlocks.
- The panel's split Create button: **Create with AI** composes the request with an in-Session instruction tail and delivers it through the chat page — a task when the agent is idle, a steering message while a Task runs (a completion race falls back to a queued task); the dialog also copies the full prompt. **Set up manually** opens the form pinned to this Session.
- The Session row menu's **Schedule a task** (after the messaging binding) opens a two-way chooser: **Create with AI** navigates to the conversation with the panel and its dialog up (route state, consumed once), **Set up manually** opens the pinned form in place (owners).
- The Schedule tab's header carries the kit's split **New** button — its AI path sends to a new Session of the Project's default agent with a tail naming the agent, `penguin schedule add` or the TOML file, and the new-Session mode — and the suggestions replace an empty table.
- The create / edit form moved out of the tab into `features/schedules/schedule-form-modal.tsx`, shared by the tab, the panel and the row menu, with a `lockedSessionId` mode; the alarm-clock glyph became `SCHEDULE_ICON` in `components/ui/icons.tsx`, worn by the agents page count, the panel and the menu entry alike; `AiCreatePanel` accepts a `byLine` override.
- The Web App docs describe the panel and the menu entry in both languages.
