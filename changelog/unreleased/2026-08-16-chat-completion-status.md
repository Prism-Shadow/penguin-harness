# Web App: chat rows say whether a Session is working, finished, or finished unread

- **Date:** 2026-08-16
- **Type:** feature
- **Scope:** `web`, `server`, `docs`
- **PR:** [#302](https://github.com/Prism-Shadow/penguin-harness/pull/302)
- **Issue:** [#291](https://github.com/Prism-Shadow/penguin-harness/issues/291)

[中文版](2026-08-16-chat-completion-status.zh.md)

A running conversation was marked by a small pulsing dot that simply vanished when the run ended, so "still working" and "finished" looked the same once the dot was gone — and a run that finished while the user was looking elsewhere left no trace at all. Sidebar rows and the chat header now carry a glyph for the Session's state: an hourglass that turns over while the Session is busy, and a circled checkmark once it has settled, tinted to say whether the last reply has been read.

## The glyphs

- **Busy** — an hourglass, turning 180 degrees twice per three-second cycle with a long hold between turns. Compaction is busy work like any other and reuses the same hourglass, in the amber tone compaction already carries elsewhere in the app; a run in progress is gray. The two live states therefore differ by colour alone, and each names itself in its tooltip and accessible name.
- **Settled** — a circled checkmark, in emerald while the Session has run since the user last opened it, and in muted gray once it has been read. Measured against the surfaces they sit on, the unread tone reaches 5.48:1 in light and 10.47:1 in dark; the read tone is deliberately recessive at 2.54:1 and 2.66:1. The pair separates by 2.16:1 in light and 3.93:1 in dark, and by 2.35:1 and 3.55:1 under simulated deuteranopia, because it differs in lightness and not only in hue.
- **Nothing at all** — a Session that has never run shows no glyph, using the server's existing `hasTrace` flag. Its slot keeps its width, so a row does not re-flow when its first run starts.
- Every glyph carries its exact state as tooltip and accessible name in both locales, including the read/unread distinction, so no state is reachable only by seeing a colour. Live states announce as a `status`; a settled one is a plain labelled image.

## Live for every row

- Run status used to be live only for the conversation the tab had open. The Session channel's `task_state` event is session-scoped and carries no id, so every other row kept whatever status the last list fetch returned: a Session left running while the user moved on stayed on its hourglass indefinitely, and one that began running in the background — a scheduled task, a subagent, another tab, or the conversation just navigated away from — never grew one at all.
- The server publishes the same flip a second time on the user-level event stream (`GET /api/events`) as `session_state`, carrying the `sessionId` plus the two row fields the glyph is drawn from: `lastActiveAt` as just stamped, and `hasTrace`. The per-Session `task_state` event is unchanged: the queued follow-up count and the undelivered-steering mirror belong to the conversation being watched, and the list event carries neither.
- `hasTrace` rides along because the glyph is drawn from three fields, not one. It is what separates "finished" from "never ran", and a Session running its first Task still carries the `false` its list row was fetched with — so the hourglass would show, and then the moment it stopped the row would go blank instead of settling into the completed marker. The event reports it as true whenever the state is running or compacting, since a Session that is running has by definition started a Task, and the client treats it as one-way for the same reason.
- The event reaches the user channels of the Project's owner and its members and no one else, and only channels a client has actually opened.
- Carrying the server's own row stamp is what makes a background completion legible: a run that finished while the user was elsewhere reads as unread, instead of settling straight into the muted already-read glyph.
- A status naming a Session no loaded page holds is dropped rather than turned into a row — the same drop that keeps another Project's Sessions out of the list.
- Nothing polls. A reconnect landing outside the channel's replay buffer already reports `resync_required`; the list refetches once on that event, so a gap in delivery cannot strand a row mid-run.
- The conversation currently open is never drawn as unread — the user is looking at it — so its glyph does not flicker while the chat page and the user channel report the same completion.

## Read and unread

- Read state is tracked in the browser, per Project, under `penguin.sessionSeen.<projectId>`. The API models no read receipt — there is no notifications table and no read column on a Session — so this follows the precedent already set for pinned Sessions, which persist client-side for the same reason.
- A marker records when the user last had a Session open; a Session counts as unread when its `lastActiveAt` is newer. Opening a Session stamps it, and so does a run finishing while the user is watching it. The marker takes the later of the wall clock and the Session's own `lastActiveAt`, so opening a Session marks it read even when the browser's clock lags the server's.
- The first marker written for a Project also records a baseline: conversations that last ran before it count as read, so turning the feature on does not flag every historical conversation at once.
- Markers are capped at 500 per Project, evicting the least recently seen, and a deleted Session's marker is pruned.
- Being browser-side, read state does not travel: the same account on a second device or browser starts with its own markers, and a second tab keeps its own view until it reloads.

## Reduced motion

Under `prefers-reduced-motion` the repository's global `animation: none !important` rule disables the turn, with no override of its own: the `hourglass-turn` keyframes only ever set `transform`, so the glyph stays exactly where it renders at rest — an upright, fully visible hourglass — rather than disappearing.
