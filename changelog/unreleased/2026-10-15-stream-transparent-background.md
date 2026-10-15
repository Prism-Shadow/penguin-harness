# Streaming replies and loading screens no longer cover the custom background

- **Date:** 2026-10-15
- **Type:** fix
- **Scope:** `ui`, `web`
- **PR:** [#1148](https://github.com/Prism-Shadow/penguin-harness/pull/1148)

[中文版](2026-10-15-stream-transparent-background.zh.md)

With a custom background image set, every transient state now shows the image the way the
settled screen does.

## Streaming

A reply, a thinking step or a tool's output that is still streaming no longer lays a band over
the image. Frost's veil over the newest lines used to be a layer painted in the page's colour; it
is now a mask that fades the newest words themselves, so whatever lies behind them, the image
included, shows through and nothing is painted over it. The fade keeps its shape, strength and
settle: the last line and a half fade to six tenths of their ink while the text arrives, and ease
back to full ink over the reveal duration once it is whole, after which the reply carries no
mask. Without an image the fade looks as before.

## Loading

- A reload shows the image from the first frame. The pre-paint script reads the background
  stored in the browser, the same one the app reads, and paints it until the first screen
  mounts; the window no longer shows the bare page colour while the app loads and signs in. The
  sign-in page still shows no background.
- Loading placeholders no longer lay solid blocks over the image: a placeholder card takes the
  light fill of the card it stands in for, and its bars become a light tint. With reduced
  transparency requested they stay solid, as cards do.
