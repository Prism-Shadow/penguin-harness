# Company mode: shorter example cards, no examples under the mission, and a calmer collapsed rail

- **Date:** 2026-10-03
- **Type:** fix
- **Scope:** `web`, `docs`
- **PR:** [#966](https://github.com/Prism-Shadow/penguin-harness/pull/966)

[中文版](2026-10-03-company-landing-and-rail.zh.md)

Four company-mode fixes from the owner's review.

## Changes

- **Example cards:** the four example companies on the empty company-mode landing show their name
  and a one-line summary of what the company does, instead of the whole mission clamped to three
  lines; the cards no longer carry a tooltip. Picking one still opens the create dialog with the
  name and the full mission filled in.
- **Create dialog:** the four examples under the mission field are gone; the examples live on the
  landing, where the choice is made.
- **Collapsed rail, mode switch:** the rail no longer carries the development/company toggle, in
  either mode. The expanded sidebar's 开发 | 公司 switch is where the mode changes.
- **Collapsed rail, top slot:** in company mode the rail's first slot is the organization's
  all-hands channel (its glyph, unread count and selection), in place of the development
  "Last conversation"; the channels under the divider list the others. Without an organization the
  slot is shown disabled.
- **Docs:** the company-mode and Web App pages describe the landing examples and the rail.
