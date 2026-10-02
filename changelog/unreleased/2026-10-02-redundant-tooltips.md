# Conventional glyphs no longer carry a tooltip that only names their gesture

- **Date:** 2026-10-02
- **Type:** fix
- **Scope:** `ui`, `web`, `ui-gallery`
- **PR:** [#952](https://github.com/Prism-Shadow/penguin-harness/pull/952)

[中文版](2026-10-02-redundant-tooltips.zh.md)

The circled "?" that discloses an explanation beside a title (`InfoPopover`, and every field, row, card, page and dialog that reached it through `info`) stopped showing a "More info" tooltip on hover; a click still opened the explanation. The same rule was applied across the Web App to the marks that read without a hint — the sidebar group's fold chevron, the search field's clear ×, the password banner's and the built-in browser tab's close ×, a ticket's child-fold chevron — and to hints that repeated text already on screen (the goal-budget field's hint paragraph, the header's "Running" word, three form pickers hinting their own field label). Each kept its `aria-label`.

## Details

- The session row's ⋯ was renamed from "More" to "More actions".
- The hint on a cut-off company ticket, inbox or session title changed from "Open ticket" / "Open session" to the whole title, with the id where it helps; the memory-changes card's rows were given their full path as the hint, and a benchmark run's model cell `provider/model`.
- Twelve `data-tooltip`s that could only ever repeat their own visible text, and so never showed, were removed.
- The gallery's breadcrumb was changed to hint the address when it is cut, instead of the copy verb.
