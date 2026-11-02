# Earlier messages in a long conversation are now reachable: a persistent scrollbar and an explicit "load earlier" control

- **Date:** 2026-10-19
- **Type:** fix
- **Scope:** `web`
- **PR:** [#1209](https://github.com/Prism-Shadow/penguin-harness/pull/1209)

[中文版](2026-10-19-chat-history-scroll-pagination.zh.md)

A long conversation opens on its newest 20 task windows, and the older ones only load when you scroll near the top. Two things made the earlier half feel lost: the transcript's scrollbar was `thin` (auto-hidden by the browser), so there was often nothing to scroll, and the top affordance stayed blank while more history existed (it only showed a spinner while loading, an error, or the "beginning of conversation" marker). The earlier messages were technically one scroll away but unreachable.

## Details

- The transcript scroll container now keeps a normal, always-visible scrollbar (`scrollbar-width: auto`), so the position and the presence of more content are visible.
- When more history exists but nothing is in flight, the top affordance shows a "Load earlier messages" button that fetches the previous window on click — the same action the scroll-to-top trigger performs, so the older messages are reachable even when the loaded window fits the viewport.
- Loading, error/retry, and "beginning of conversation" states are unchanged.
