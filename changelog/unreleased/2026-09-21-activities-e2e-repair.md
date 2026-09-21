# Repair the activities browser suite and restore its editor notices

- **Date:** 2026-09-21
- **Type:** fix
- **Scope:** `web`
- **PR:** [#29](https://github.com/Prism-Shadow/penguin-harness/pull/29)

Every test in the activities browser suite timed out in setup, so the suite had been
proving nothing. Its helper opened the activities page and filled a product code straight
away, but creation had moved behind the landing's action into a dialog. The helper now
opens that dialog, and the three assertions that had drifted from the page were brought
back to what it renders.

## Editor notices

Repairing the suite surfaced a real gap it had been written to catch. Splitting the
activity editor onto its own route left the owner-only and Project-unavailable notices
behind on the list. The editor still disabled itself in both cases, but no longer said
why. Both notices now render above the editor as they do above the list.

## Details

- The "Open WAF preview" link and the "Built from an earlier draft" notice each appear
  twice, once in the runs list and once on the embedded preview, so those assertions
  target the first rather than requiring a single match.
- An activity card leads with its title, so the card is matched by title instead of by
  the old product-code-first ordering.
