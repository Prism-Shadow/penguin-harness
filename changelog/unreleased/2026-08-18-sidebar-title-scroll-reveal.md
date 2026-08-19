# Web App: truncated sidebar titles scroll their full text into view

- **Date:** 2026-08-18
- **Type:** fix
- **Scope:** `web`
- **PR:** [#328](https://github.com/Prism-Shadow/penguin-harness/pull/328)
- **Issue:** [#309](https://github.com/Prism-Shadow/penguin-harness/issues/309)

[中文版](2026-08-18-sidebar-title-scroll-reveal.zh.md)

Conversation titles in the chat sidebar are clipped to one line, and the only way past the clipping was a native tooltip that is easy to miss — conversations sharing a long prefix were indistinguishable from one another. Hovering a row, or reaching it with keyboard focus, now scrolls the clipped title's hidden tail into view, on session rows and parked-draft rows alike.

## The reveal

- The title holds still for 0.3s before anything moves, then slides left by the measured overflow at a constant reading speed (60 px/s, so short and long titles skim at the same pace) over a duration clamped between 0.35s and 4s. It rests at the end for as long as the hover or focus lasts, and snaps back in a single frame the moment either ends.
- Nothing changes during the hold, the ellipsis included, so a pointer crossing the sidebar on its way elsewhere leaves every row exactly as it found it. Every declaration that alters the rendering sits inside the `title-scroll-reveal` keyframes with a `forwards`-only fill — among them the `inline-block` that makes the text transformable, which is also what retires the ellipsis, so the "…" survives right up to the frame the slide starts on.
- `:focus-visible` scopes the keyboard trigger to actual keyboard focus rather than to any focus landing in the row, and it sits inside a forgiving `:is()`, so an engine without `:has()` still gets the hover trigger.
- The animation is pure CSS, driven by two custom properties (`--title-scroll-shift`, `--title-scroll-ms`) that `Truncated` measures and publishes: no timers, no per-row media-query subscriptions. The transform is clipped inside the row's existing box, so there is no layout shift, and the row's click, drag-reorder and hover action buttons are untouched.
- A title that fits is measured as fitting and stays perfectly still — no class, no variables, no tooltip. The measurement re-runs on resize and when the title or its styling changes, and a 1px subpixel tolerance keeps a rounding artifact from producing either a spurious tooltip or a 1px scroll.

## Reduced motion and assistive technology

- Under `prefers-reduced-motion` the repo's global `animation: none !important` block disables the reveal outright, with no override of its own. The title then renders exactly as it does at rest: the plain ellipsis, plus the `title` tooltip that a truncated title already carried for pointer hover.
- The full title stays in the DOM whether or not it is visually clipped, so screen readers announce all of it.
- Touch has neither hover nor keyboard focus, and mobile browsers do not surface `title` on long-press; there the full text is reached by opening the Session.
