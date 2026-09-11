# The price fields size their own currency symbol and unit

- **Date:** 2026-09-11
- **Type:** fix
- **Scope:** `web`
- **PR:** [#683](https://github.com/Prism-Shadow/penguin-harness/pull/683)

[中文版](2026-09-11-price-unit-overlap.zh.md)

The three price inputs in the model settings dialog draw the currency symbol inside their left
edge and the `/M tok` unit inside their right, and reserved room for both with a fixed padding.
That padding was 1.2px narrower than the unit needs at the default font, so the value ran into
`/M tok` at every font size, in both currencies and both languages. Each input now derives its
padding from the width the symbol and the unit actually render at, measured live, so the value
keeps a fixed gap from both whatever the resolved font, the interface font size and the selected
currency make them.
