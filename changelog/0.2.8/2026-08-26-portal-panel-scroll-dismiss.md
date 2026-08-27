# Portal panels stay open while an unrelated container scrolls

- **Date:** 2026-08-26
- **Type:** fix
- **Scope:** `web`
- **PR:** [#495](https://github.com/Prism-Shadow/penguin-harness/pull/495)

[中文版](2026-08-26-portal-panel-scroll-dismiss.zh.md)

Every panel opened through the shared portal-panel hook — `OptionMenu`, `Select`, `InfoPopover` and the composer toolbar's context ring — closed on any scroll anywhere in the document. Clicking the context ring to watch the context fill during a streaming run closed the panel on the next chunk that arrived. These panels now close only when the scrolled container holds the panel's own trigger.

## Details

- The hook listens for `scroll` in the capture phase, because scroll events do not bubble; capture on `window` then hears every scrolling element in the page. The message list scrolls itself on every streamed chunk, and each of those scrolls closed panels anchored in the header and the composer, which had not moved.
- The dismissal is kept rather than replaced by re-positioning: the panel is placed once when it opens and does not follow its trigger, so a scroll that did move the trigger leaves the panel pointing at nothing. The hook now answers `scrollMovesAnchor` — the rule added for [the Session row's context menu](2026-08-26-context-menu-scroll-dismiss.md) — with the trigger element it already holds.
- The panel's own internal scroll still does not close it, and a window resize still closes unconditionally: a resize moves every trigger on the page at once.
- A trigger the rule cannot read (a consumer that attaches no ref) closes on any scroll, as before, so no panel can become one that scrolling never dismisses.
