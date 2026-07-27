# Web App: running-state chat rows keep to one line on phones

Below the `sm` breakpoint, every row involved in a running turn used to wrap and grow — the header squeezed the session title away, the work-group title bar folded onto two lines, and the per-reply stats footer wrapped its chips onto a clipped second row that painted over the content below.

## Chat header

- The "Running" indicator collapses to its pulsing dot (the wording moves to the hover title), and the Workspace button becomes icon-only (`title`/`aria-label` keep its name), so the session title keeps its room.

## Work group and tool cards

- The group header drops the step count below `sm` and, when collapsed with a pending approval, marks it with a bare amber dot — `role="img"` with `title`/`aria-label` (non-live, so re-renders don't chatter at screen readers) — instead of the text pill.
- The "waiting for approval" text on the tool-card row yields to the labeled amber status icon below `sm`, and the pending block's name + arguments preview stays one line (the preview truncates instead of wrapping under the name pill).
- Allow/Deny become icon-only glyph buttons below `sm`, keeping their accessible names.
- The approval-decision pill ("Approved · auto" etc.) no longer wraps into a taller card: it keeps its content width, shows only the decision half below `sm`, and carries the full wording via `title`/`aria-label`.

## Per-reply stats footer

- The footer stays one fixed line at every width **without dropping any stat**: on narrow screens the timestamp + chips span scrolls sideways under a hidden scrollbar, while the copy button sits outside the scroll area, pinned reachable at the row's end.
