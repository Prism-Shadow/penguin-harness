# Machines: the selection bar is glyphs again, and a card names its server root

- **Date:** 2026-09-07
- **Type:** improvement
- **Scope:** `server`, `web`

[中文版](2026-09-07-machines-bar-and-root.zh.md)

The four buttons in the selection bar — select all, select none, use, stop using — drop their words and their frames, and go back to glyphs alone. Four labelled buttons in one row read as a sentence nobody wrote, and each glyph is already the plainest thing about its button: the box, the empty box, the plug, the unplugged plug. The box goes with the word: a bordered button holding nothing but a glyph draws a frame around something already legible, and four in a row are four frames. What is left is the glyph and a hover, the same shape as the chevron that unfolds a card. The word stays as the tooltip and as the accessible name. Verbs that stand alone — configure, new, force install — keep theirs.

A card's details now name the **server root** on that machine (`PENGUIN_HOME`). The profile decides it — a dev instance reaches a machine's dev installation and never the release one beside it — so two instances of this page can say the same machine and mean different servers, and until now the page did not say which. It is written in that machine's own spelling once its platform is known; the local entry names this process's own root.
