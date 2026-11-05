# The context ring's hover hint opens above it

- **Date:** 2026-10-13
- **Type:** fix
- **Scope:** `ui`
- **PR:** [#1098](https://github.com/Prism-Shadow/penguin-harness/pull/1098)

[中文版](2026-10-13-context-ring-tooltip.zh.md)

Hovering the composer's context ring showed its hint under the ring, where the bottom edge of the
window cut it in half, in every theme. A hint that hangs under a control now opens above it when the
window has no room for it below and more room above; everywhere else it still opens below. Any hover
hint on a control at the foot of the window behaves the same way, not only the ring's.
