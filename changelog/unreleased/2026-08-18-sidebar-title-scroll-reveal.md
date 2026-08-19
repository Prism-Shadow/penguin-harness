# Web App: truncated sidebar titles scroll their full text into view

Long conversation titles in the chat sidebar are ellipsis-truncated, and hovering revealed nothing beyond the (easily missed) native tooltip — conversations sharing a prefix were indistinguishable (#309). Hovering a row, or reaching it with keyboard focus, now scrolls the truncated title's hidden tail into view.

## Behavior

- After a 0.3s hold (so a mouse merely passing across the sidebar doesn't set every long title in motion), the title slides left at a constant reading speed — the duration is proportional to the measured hidden width, clamped between 0.35s and 4s — holds at the end, and snaps back the instant the hover/focus ends.
- Titles that fit are measured as such and stay perfectly still; the measurement re-runs on resize and when the title or its style changes.
- The scroll is a pure CSS transform clipped inside the row's existing box: no layout shift, no timers, and the row's click, drag-reorder, and hover action buttons are untouched.
- Under `prefers-reduced-motion` the animation is disabled and the reveal falls back to the native `title` tooltip, which also serves touch long-press; the full title always remains in the DOM, so screen readers announce it regardless of the visual clipping.
- Parked-draft rows get the same treatment as session rows.
