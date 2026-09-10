# Copy a Session's id from its row menu

- **Date:** 2026-08-30
- **Type:** feature
- **Scope:** `web`
- **PR:** [#550](https://github.com/Prism-Shadow/penguin-harness/pull/550)

[中文版](2026-08-30-copy-session-id.zh.md)

A Session's id was reachable only from the chat header's details card. It is now also an action on the Session row itself, in the same menu as pin, rename, archive and delete — reached by the row's ellipsis button or by right-clicking it.

## Details

- The action carries the details card's label and glyph, so one value has one mark wherever it is met.
- It sits next to rename, the other action about which Session this is rather than what happens to it, and is offered on folder rows (archived, subagent, scheduled) too — those are exactly when an id is wanted.
- The hover affordance is unchanged: archive alone, plus the ellipsis that opens the menu.
- Copying confirms with a toast rather than the usual at-the-button check, because acting on a menu row closes the panel the button lives in.
