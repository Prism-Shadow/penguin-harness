# The conversation outline lists every turn, whatever is loaded

- **Date:** 2026-09-05
- **Type:** feature
- **Scope:** `web`, `server`
- **PR:** [#623](https://github.com/Prism-Shadow/penguin-harness/pull/623)

[中文版](2026-09-05-outline-index.zh.md)

The quick-jump rail beside the transcript, and its toolbar fallback on narrow screens, now list every turn of the conversation rather than the turns that happen to be loaded. The server keeps an outline index — each turn's number, its position in the Trace, the question and a reply preview — assembled by the same scan that cuts the message windows and cached with it, and exposes it as `GET /api/sessions/:id/outline`. Loaded turns keep their live previews; a click on any other turn opens the transcript at it, detached from the live end, and the jump completes as soon as that window is on screen. The index refreshes each time a Task ends, and a server without the endpoint leaves the rail as it was.
