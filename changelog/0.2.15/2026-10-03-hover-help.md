# The circled "?" opens its explanation on hover

- **Date:** 2026-10-03
- **Type:** feature
- **Scope:** `ui`, `docs`
- **PR:** [#966](https://github.com/Prism-Shadow/penguin-harness/pull/966)

[中文版](2026-10-03-hover-help.zh.md)

The circled "?" beside a title (`InfoPopover`) used to need a click before it said anything. It
now opens on hover, and the behaviour lives in the UI package for any panel that reveals itself
the same way.

## Changes

- **Hover:** a mouse resting on the "?" opens its explanation after the tooltip's delay, so hover
  help has one timing across the app. Leaving closes it after a short grace, unless the pointer
  moves into the panel, which stays open while hovered so its text can be selected or a link
  clicked.
- **Click, touch and keyboard:** a click pins the panel open until a second click, an outside
  click, Esc or a scroll. On a touch screen a tap opens it, as before. Enter and Space toggle it;
  focus alone does not open it.
- **`useHoverDisclosure`:** the hover, grace, pin and touch rules are one hook in
  `@prismshadow/penguin-ui`, and the tooltip's open delay is exported as `HOVER_OPEN_DELAY_MS`.
  `InfoPopover` is built on the hook; the inline `HelpFold` still opens on a click.
- **Docs:** the Settings page says how to read and keep a "?" open.
