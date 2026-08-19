# Web App: chat rows say whether a Session is working, finished, or finished unread

- **Date:** 2026-08-16
- **Type:** feature
- **Scope:** `web`
- **PR:** [#302](https://github.com/Prism-Shadow/penguin-harness/pull/302)
- **Issue:** [#291](https://github.com/Prism-Shadow/penguin-harness/issues/291)

[中文版](2026-08-16-chat-completion-status.zh.md)

A running conversation was marked by a small pulsing dot that simply vanished when the run ended, so "still working" and "finished" looked the same once the dot was gone — and a run that finished while the user was looking elsewhere left no trace at all. Sidebar rows and the chat header now carry a glyph for the Session's state: an hourglass that turns over while the Session is busy, and a circled checkmark once it has settled, tinted to say whether the last reply has been read.

## The glyphs

- **Busy** — an hourglass, turning 180 degrees twice per three-second cycle with a long hold between turns. Compaction is busy work like any other and reuses the same hourglass, in the amber tone compaction already carries elsewhere in the app; a run in progress is gray. The two live states therefore differ by colour alone, and each names itself in its tooltip and accessible name.
- **Settled** — a circled checkmark, in emerald while the Session has run since the user last opened it, and in muted gray once it has been read. Measured against the surfaces they sit on, the unread tone reaches 5.48:1 in light and 10.47:1 in dark; the read tone is deliberately recessive at 2.54:1 and 2.66:1. The pair separates by 2.16:1 in light and 3.93:1 in dark, and by 2.35:1 and 3.55:1 under simulated deuteranopia, because it differs in lightness and not only in hue.
- **Nothing at all** — a Session that has never run shows no glyph, using the server's existing `hasTrace` flag. Its slot keeps its width, so a row does not re-flow when its first run starts.
- Every glyph carries its exact state as tooltip and accessible name in both locales, including the read/unread distinction, so no state is reachable only by seeing a colour. Live states announce as a `status`; a settled one is a plain labelled image.

## Read and unread

- Read state is tracked in the browser, per Project, under `penguin.sessionSeen.<projectId>`. The API models no read receipt — there is no notifications table and no read column on a Session — so this follows the precedent already set for pinned Sessions, which persist client-side for the same reason.
- A marker records when the user last had a Session open; a Session counts as unread when its `lastActiveAt` is newer. Opening a Session stamps it, and so does a run finishing while the user is watching it. The marker takes the later of the wall clock and the Session's own `lastActiveAt`, so opening a Session marks it read even when the browser's clock lags the server's.
- The first marker written for a Project also records a baseline: conversations that last ran before it count as read, so turning the feature on does not flag every historical conversation at once.
- Markers are capped at 500 per Project, evicting the least recently seen, and a deleted Session's marker is pruned.
- Being browser-side, read state does not travel: the same account on a second device or browser starts with its own markers, and a second tab keeps its own view until it reloads.

## Reduced motion

Under `prefers-reduced-motion` the repository's global `animation: none !important` rule disables the turn, with no override of its own: the `hourglass-turn` keyframes only ever set `transform`, so the glyph stays exactly where it renders at rest — an upright, fully visible hourglass — rather than disappearing.
