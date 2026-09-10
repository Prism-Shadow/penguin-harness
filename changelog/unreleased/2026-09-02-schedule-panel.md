# Scheduled tasks in the chat dock, and the Schedule tab's AI path

- **Date:** 2026-09-02
- **Type:** feature
- **Scope:** `web`, `docs`
- **PR:** [#593](https://github.com/Prism-Shadow/penguin-harness/pull/593)

[中文版](2026-09-02-schedule-panel.zh.md)

Scheduled tasks became reachable from the conversation itself. The chat page's dock gained a **Scheduled tasks** panel listing the tasks bound to the current Session and creating new ones, a conversation with tasks bound to it wears an alarm clock beside its title, and the Agent settings Schedule tab joined the "Create with AI" pattern — with one twist: from inside a conversation, the AI path sends the request into that conversation rather than opening a new one.

## Details

- A new dock panel kind, `schedules`: the current Session's tasks (an agent's schedules filtered to this Session), a search box and All / Active / Paused / Completed filters, rows with a state glyph, the task name and a plain-language schedule line (`describeSchedule`: "Every day at 08:00 · Next: tomorrow 08:00", "Every Monday at 09:00", "Every 30 minutes", "One-off · Sep 3, 10:00", settled states named up front), an enable switch and an edit / delete menu for owners, and a Suggestions list (daily brief, weekly review, follow-up reminder, update monitor). The list refetches when the tab comes to the front, on window focus, on a `schedule_fired` / `schedule_queued` event, every 30 s while visible, and after every change; the draft page shows what the first message unlocks.
- The panel's header is where a task bound to a conversation is created — two peer buttons on a row of their own under the title, since the dock's width is user-dragged and a title-adjacent pair clips when narrow. The dark **Create with AI** (`MAGIC_WAND_ICON`, every member) composes the request with an in-Session instruction tail and delivers it through the chat page — a task when the agent is idle, a steering message while a Task runs (a completion race falls back to a queued task); the dialog also copies the full prompt. The light **Create manually** (the new `HAND_ICON`, owners) opens the form pinned to this Session.
- A Session with tasks bound to it wears an alarm clock and its count right of the conversation title in the chat toolbar, named `"3 scheduled tasks"` and opening the panel on click. It and the panel read one shared store (`features/schedules/schedule-store.ts`, one agent's list, `boundScheduleCount` narrowing it to a Session), refreshed on the Session changing, on window focus, on the two schedule events, and after every mutation the panel makes — no new server field.
- The Schedule tab's header carries the kit's split **New** button — its AI path sends to a new Session of the Project's default agent with a tail naming the agent, `penguin schedule add` or the TOML file, and the new-Session mode — and the suggestions replace an empty table.
- The create / edit form moved out of the tab into `features/schedules/schedule-form-modal.tsx`, shared by the tab and the panel, with a `lockedSessionId` mode; the alarm-clock glyph became `SCHEDULE_ICON` in `components/ui/icons.tsx`, worn by the agents page count, the panel and the toolbar mark alike; `AiCreatePanel` accepts a `byLine` override.
- The Web App docs describe the panel, its two buttons and the toolbar mark in both languages.
