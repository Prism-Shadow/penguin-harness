# Conventional glyphs no longer carry a tooltip that only names their gesture

- **Date:** 2026-10-02
- **Type:** fix
- **Scope:** `ui`, `web`, `ui-gallery`

[中文版](2026-10-02-redundant-tooltips.zh.md)

The circled "?" that discloses an explanation beside a title (`InfoPopover`, and every field, row, card, page and dialog that reaches it through `info`) no longer shows a "More info" tooltip on hover: the mark beside its title already says what it is, and a click shows the explanation. The same rule was applied across the Web App to the marks that are read without a hint — the sidebar group's fold chevron, the search field's clear ×, the password banner's and the built-in browser tab's close ×, a ticket's child-fold chevron — and to hints that repeated text already on screen (the goal-budget field's hint paragraph, the header's "Running" word, three form pickers hinting their own field label). Each keeps its `aria-label`.

## Details

- The session row's ⋯ is named "More actions" instead of "More".
- A company ticket, inbox or session title that is cut off now hints its whole title (with the id where one helps) instead of "Open ticket" / "Open session"; the memory-changes card's rows hint their full path, a benchmark run's model cell hints `provider/model`.
- A dozen `data-tooltip`s that could only ever repeat their own visible text were removed; they never showed.
- The gallery's breadcrumb hints the address when it is cut, not the copy verb.
