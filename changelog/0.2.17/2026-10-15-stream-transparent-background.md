# Streaming text fades in smoothly; streaming and loading no longer cover the custom background

- **Date:** 2026-10-15
- **Type:** fix
- **Scope:** `ui`, `web`
- **PR:** [#1148](https://github.com/Prism-Shadow/penguin-harness/pull/1148)

[中文版](2026-10-15-stream-transparent-background.zh.md)

In Frost, streaming text fades in as it arrives instead of popping in a word at a time. With a
custom background image set, every transient state now shows the image the way the settled screen
does.

## Streaming

A reply, a thinking step or a tool's output that is still streaming no longer lays a band over
the image. Frost's veil over the newest lines used to be a layer painted in the page's colour; it
is now a mask that fades the newest words themselves, so whatever lies behind them, the image
included, shows through and nothing is painted over it. The fade keeps its shape, strength and
settle: the last line and a half fade to six tenths of their ink while the text arrives, and ease
back to full ink over the reveal duration once it is whole, after which the reply carries no
mask. Without an image the fade looks as before.

## Arriving text

In Frost, new words no longer pop in one at a time when tokens arrive fast. Each stretch of text
the reveal puts on screen fades in on its own over the reveal duration, in prose, lists, tables,
inline code, math and code blocks alike, and a list item, table or code block that arrives whole
fades in as one, its bullet and fill with it. The words are on screen at once and only their ink
rises; nothing is painted, so the image behind shows through them. A reply whose first delta is
large is revealed from its start rather than showing its opening lines at once. When the last
stretch has faded, the reply is exactly the markup of one that never streamed; code highlighting
and formulas appear then, up to the reveal duration later than before. Primer and Console are
unchanged, and with reduced motion the text shows at once.

## Loading

- A reload shows the image from the first frame. The pre-paint script reads the background
  stored in the browser, the same one the app reads, and paints it until the first screen
  mounts; the window no longer shows the bare page colour while the app loads and signs in. The
  sign-in page still shows no background.
- Loading placeholders no longer lay solid blocks over the image: a placeholder card takes the
  light fill of the card it stands in for, and its bars become a light tint. With reduced
  transparency requested they stay solid, as cards do.
