# A conversation opens on its last ten Tasks

- **Date:** 2026-09-04
- **Type:** change
- **Scope:** `web`
- **PR:** [#616](https://github.com/Prism-Shadow/penguin-harness/pull/616)

[中文版](2026-09-04-messages-tail-window.zh.md)

Opening a conversation now reads its newest ten Tasks instead of a window sized to swallow most sessions whole. What a reader looks at when a conversation opens is its end, and the read, the transfer and the parse all scale with the window — so the old size made the common open cost what the longest session it might have had to serve costs. Older history is fetched as it is scrolled to, as it already was; the scroll-up window is unchanged.
