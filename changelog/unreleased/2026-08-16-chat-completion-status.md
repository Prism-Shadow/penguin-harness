# Web App: chat rows say whether a Session is working, and whether it finished with something unread

- **Date:** 2026-08-16
- **Type:** feature
- **Scope:** `web`, `server`, `docs`
- **PR:** [#302](https://github.com/Prism-Shadow/penguin-harness/pull/302)
- **Issue:** [#291](https://github.com/Prism-Shadow/penguin-harness/issues/291)

[中文版](2026-08-16-chat-completion-status.zh.md)

A running conversation was marked by a small pulsing dot that simply vanished when the run ended, so "still working" and "finished" looked the same once the dot was gone — and a run that finished while the user was looking elsewhere left no trace at all. Sidebar rows now carry an hourglass that turns over while the Session is busy, and a green dot afterwards for as long as the last reply has not been read.

## The glyphs

Three states, two shapes:

- **Busy** — an hourglass, turning 180 degrees twice per three-second cycle with a long hold between turns. Compaction is busy work like any other and reuses the same hourglass, keeping the amber tone compaction already carries elsewhere in the app; a run in progress is gray. The two live states therefore differ by colour alone, and each names itself in its tooltip and accessible name.
- **Finished, unread** — a small green dot. It is a notification rather than a status: it says there is a reply here you have not seen. Measured against the surfaces it sits on it reaches 3.77:1 in light and 10.37:1 in dark, clearing the 3:1 bar for non-text graphics in both themes; being the only marker left in the list, it is a shade darker in light mode than the emerald it was first drawn in, which reached only 2.57:1 on white.
- **Nothing at all** — a Session whose last reply has been read shows no glyph, and neither does one that has never run (the server's existing `hasTrace` flag is what tells them apart internally). The marker is removed rather than muted, so the only marks left in the list are the ones worth acting on. Every row reserves the glyph's width whatever its state, so nothing re-flows as a run starts, finishes, and is read.
- The chat header carries the hourglass alone: the conversation on screen is by definition read, so it has no dot to show.
- Both live states and the dot carry their exact state as tooltip and accessible name in both locales, so nothing is reachable only by seeing a colour. Live states announce as a `status`; the dot is a plain labelled image. The read state announces nothing because it renders nothing, which is correct — there is no state to report.

## Live for every row

- Run status used to be live only for the conversation the tab had open. The Session channel's `task_state` event is session-scoped and carries no id, so every other row kept whatever status the last list fetch returned: a Session left running while the user moved on stayed on its hourglass indefinitely, and one that began running in the background — a scheduled task, a subagent, another tab, or the conversation just navigated away from — never grew one at all.
- The server publishes the same flip a second time on the user-level event stream (`GET /api/events`) as `session_state`, carrying the `sessionId` plus the two row fields the glyph is drawn from: `lastActiveAt` as just stamped, and `hasTrace`. The per-Session `task_state` event is unchanged: the queued follow-up count and the undelivered-steering mirror belong to the conversation being watched, and the list event carries neither.
- `hasTrace` rides along because the glyph is drawn from three fields, not one. A Session running its first Task still carries the `false` its list row was fetched with, so the hourglass would show and then the moment it stopped the row would go blank instead of showing the unread dot. The event reports it as true whenever the state is running or compacting, since a Session that is running has by definition started a Task, and the client treats it as one-way for the same reason. The flag stays load-bearing even though read and never-ran now look identical: a conversation created after this browser first saw the Project has no read marker of its own and its creation time is later than the baseline, so without the flag every brand-new row would wear the dot before it had ever run.
- The event reaches the user channels of the Project's owner and its members and no one else, and only channels a client has actually opened.
- Carrying the server's own row stamp is what makes a background completion legible: a run that finished while the user was elsewhere shows the dot, instead of settling silently as though it had already been read.
- A status naming a Session no loaded page holds is dropped rather than turned into a row — the same drop that keeps another Project's Sessions out of the list.
- Nothing polls. A reconnect landing outside the channel's replay buffer already reports `resync_required`; the list refetches once on that event, so a gap in delivery cannot strand a row mid-run.
- The conversation currently open is never drawn as unread — the user is looking at it — so no dot flashes onto its row while the chat page and the user channel report the same completion.

## Read and unread

- Read state is tracked in the browser, per Project, under `penguin.sessionSeen.<projectId>`. The API models no read receipt — there is no notifications table and no read column on a Session — so this follows the precedent already set for pinned Sessions, which persist client-side for the same reason.
- A marker records when the user last had a Session open; a Session counts as unread when its `lastActiveAt` is newer. Opening a Session stamps it, and so does a run finishing while the user is watching it. The marker takes the later of the wall clock and the Session's own `lastActiveAt`, so opening a Session marks it read even when the browser's clock lags the server's.
- The first marker written for a Project also records a baseline: conversations that last ran before it count as read, so turning the feature on does not light up every historical conversation at once.
- Markers are capped at 500 per Project, evicting the least recently seen, and a deleted Session's marker is pruned.
- Being browser-side, read state does not travel: the same account on a second device or browser starts with its own markers, and a second tab keeps its own view until it reloads.

## Reduced motion

Under `prefers-reduced-motion` the repository's global `animation: none !important` rule disables the turn, with no override of its own: the `hourglass-turn` keyframes only ever set `transform`, so the glyph stays exactly where it renders at rest — an upright, fully visible hourglass — rather than disappearing.
