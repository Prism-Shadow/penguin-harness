# The model settings fields size their own in-field units

- **Date:** 2026-09-11
- **Type:** fix
- **Scope:** `web`
- **PR:** [#683](https://github.com/Prism-Shadow/penguin-harness/pull/683)

[中文版](2026-09-11-price-unit-overlap.zh.md)

Five inputs in the model settings dialog draw a unit inside their own box and reserved room for
it with a fixed padding. Each reserve is now derived from the width its unit actually renders at,
measured live, so the value keeps the same gap from it whatever the resolved font, the interface
font size and the selected currency make that unit.

## Details

- The three price fields carry the currency symbol on the left and `/M tok` on the right. The
  right reserve was 1.2px narrower than the unit occupies at the default interface font, so the
  value ran into `/M tok` at every font size, in both currencies and both languages.
- The context window and max output tokens fields carry the `Token` unit, whose fixed reserve ran
  5.8–7.3px wider than it occupies. Both now leave the same measured gap as the price fields.
- The max output tokens placeholder is wider than its half-width cell in English, and an input
  clips at its padding box rather than at its value area, so the placeholder reached the unit and
  read as `Empty = inherit agent set Token`. Both fields in that row now end an overlong
  placeholder in an ellipsis; the full text stays on the field's hover title.
