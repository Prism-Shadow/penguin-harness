# Scrolling up in a conversation no longer bounces back down while a reply streams

- **Date:** 2026-10-20
- **Type:** fix
- **Scope:** `web`, `ui`
- **PR:** [#1250](https://github.com/Prism-Shadow/penguin-harness/pull/1250)

[中文版](2026-10-20-chat-scroll-up-bounce.zh.md)

While a reply or a tool output was streaming, wheeling up from the bottom of the conversation was often followed by a small jump back down: the view moved by the text that had just arrived, and in Frost also by a line or two at a time after the gesture. Following the bottom now stops at the first tick of an upward wheel, stays off until the reader scrolls back down, and text that is still fading in no longer carries the view along.

## Details

- The transcript listens for the wheel itself, with a listener that is not passive and never prevents the scroll, so the browser hands the page the first tick of a gesture before it scrolls; the rest of the gesture stays asynchronous. A stream update arriving in between no longer snaps the view back to the bottom.
- Following resumes only when the reader's own scroll brings the view back within 80px of the bottom. The scroll event of an earlier snap, which arrives a frame later with nothing moved, no longer turns following back on after the reader has started scrolling up.
- A stream update, a resize of the transcript and the selection menu closing read where the view stands before snapping it, so a scroll the browser has made but not yet reported (a key, the scrollbar, a find or outline jump) is left in place.
- In Frost, text still fading in is no longer a scroll anchor. The browser had anchored on it at the live edge and moved a reader who had scrolled up along with the stream.
- `packages/web/e2e/scroll-follow-bounce.spec.mjs` streams a reply in each theme on a renderer slowed four times, wheels up from the bottom and records every frame, wheel event and programmatic scroll. It fails on a snap that lands after the gesture could already be on screen, on a frame showing a snap combined with the gesture, on text moving back up after the gesture moved it down, and on any movement in the second after the gesture. It runs on demand, outside CI.
