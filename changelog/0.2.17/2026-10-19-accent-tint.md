# The accent tints the person's own messages

- **Date:** 2026-10-19
- **Type:** feature
- **Scope:** `ui`
- **PR:** [#1223](https://github.com/Prism-Shadow/penguin-harness/pull/1223)

[中文版](2026-10-19-accent-tint.zh.md)

The accent chosen under Appearance used to colour only solid marks: buttons, switches, radio and
check marks, selected markers. It now also gives a light tint to the surfaces that hold the
person's own words, through one new theme token, `accent-tint`: the accent mixed into the page.

## Surfaces

- The user message bubble and the steering chip sit on the accent's tint; the chip keeps its
  neutral border, and its "User steering" label is now in the body text colour rather than the
  muted gray, so it reads clearly on the tint.
- In a company channel, the reader's own bubble takes the same tint in place of the light blue
  wash of the link colour. Other people's bubbles stay neutral gray.
- With the accent left at "Theme's own" the tint is a gray: in light mode about half a gray step
  darker than the old bubble, in dark mode within a step of it.

## Strength

- The tint is 8% of the accent in light mode and 10% in dark mode; Primer's five presets take
  12%, so a hue reads clearly.
- The accent's translucent wash (`accent-muted`, the selected choice in an interactive reply)
  moves to the same strengths: Frost from 14% / 18% and Console from 10% / 16% to 8% / 10%,
  and Primer's own dark accent from 12% to 10%. Primer's presets are unchanged.

## On a custom background

- The bubble and the chip take the accent's translucent wash instead of the opaque tint, so the
  image shows through with the accent's hue. Over a page-coloured patch of the image the two
  look the same.
- Inside a dialog, and with reduced transparency requested, they keep the opaque tint.
