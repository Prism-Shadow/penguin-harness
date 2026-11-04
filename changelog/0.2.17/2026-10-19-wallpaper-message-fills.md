# User messages and notices give way to the custom background

- **Date:** 2026-10-19
- **Type:** fix
- **Scope:** `ui`
- **PR:** [#1220](https://github.com/Prism-Shadow/penguin-harness/pull/1220)

[中文版](2026-10-19-wallpaper-message-fills.zh.md)

With a custom background image set, the user's message bubbles and the notices in the page no
longer lay opaque slabs over the image. They take the same shared fill roles the background
already gave canvases, panels and controls, so every page that uses the shared bubbles and notices
follows without changes of its own.

## Messages

- The user message bubble, the steering chip, other people's bubbles in a company channel, tag
  chips and the composer's stop button take a light wash of the text colour on the image instead
  of the theme's solid gray.

## Notices

- In Primer, a notice strip, a callout and the banner across the main column keep their tone on
  the image at half their tint; the text colour is unchanged.
- In Frost, a notice in the page becomes a card like the others on the image: the panel's light
  glass, with its shadow and its tone dot.
- In Console, a notice in the page paints nothing under its line, with or without an image; a
  toast still takes the page colour where it floats.
- The amber approval band under a tool call waiting on a decision thins like a notice: at half
  its tint in Primer and Frost, and with nothing painted in Console, where the tone tint is clear.

## What stays solid

- Toasts, and bubbles and notices inside a dialog, keep their solid surfaces.
- With reduced transparency requested, bubbles and notices return to their solid colours, as
  panels do.
