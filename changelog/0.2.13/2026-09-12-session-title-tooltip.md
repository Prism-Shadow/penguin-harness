# A scrolling session title no longer also raises a tooltip

- **Date:** 2026-09-12
- **Type:** fix
- **Scope:** `web`
- **PR:** [#706](https://github.com/Prism-Shadow/penguin-harness/pull/706)
- **Issue:** [#570](https://github.com/Prism-Shadow/penguin-harness/issues/570)

[中文版](2026-09-12-session-title-tooltip.zh.md)

Hovering a sidebar session whose title was too long for the row disclosed that title twice at
once: the text scrolled its clipped tail into view, and a native tooltip carrying the same text
opened over it. The scroll is now the only disclosure on those rows.

## Details

- `Truncated` attaches its `title` only where the tail cannot be scrolled into view — callers
  that do not ask for the scroll reveal keep the tooltip exactly as before.
- Under the system "reduce motion" preference the reveal's keyframes are disabled and nothing
  scrolls, so the tooltip stays there as the pointer-hover fallback.
- This covers the sidebar's session rows and its draft rows, the two places that use the scroll
  reveal.
