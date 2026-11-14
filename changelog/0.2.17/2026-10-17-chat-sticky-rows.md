# The transcript's work group heads and open rows pin again under a custom background

- **Date:** 2026-10-17
- **Type:** fix
- **Scope:** `ui`, `web`, `ci`
- **PR:** [#1187](https://github.com/Prism-Shadow/penguin-harness/pull/1187)

[中文版](2026-10-17-chat-sticky-rows.zh.md)

With a custom background set, the conversation's work group heads (“Running”, “Done”) and the open thinking and tool rows under them had stopped pinning to the top of the transcript: custom backgrounds ([#1126](https://github.com/Prism-Shadow/penguin-harness/pull/1126)) made them scroll away with their bodies, since a clear row pinned over the text would have laid its words over the lines moving underneath. They pin again, at both levels, and still sit on the image with no strip of their own.

## Details

- While a head or a row is stuck, it paints the page colour and the background image again under its words, laid against the window exactly as the shell's own image is (`WallpaperBackdrop` in the shared UI package), so it still reads as clear while the text scrolling under it is hidden. At rest nothing is drawn.
- The image is a fixed background (`background-attachment: fixed`), as the maximized dock's copy is. Message entrances (`.anim-msg`) now fill backwards only: a finished entrance held its end state, so every message kept a transform, and inside a transformed box a fixed background scrolls with the box, which would have shown the image shifted and rescaled on a stuck row.
- Only stuck rows draw it, found through a CSS scroll-state container query. A browser without scroll-state queries keeps the earlier behaviour: under a custom background the rows scroll with their bodies. Reduced transparency is unchanged: the rows keep their theme surfaces and pin.
- Without a custom background nothing changed.
- A Playwright scenario (`packages/web/e2e/sticky-rows.spec.mjs`), run by CI's browser job beside the smoke suite, scrolls an open tool output under the group head and its row in each theme, with and without a custom background, and checks that both stay pinned, that nothing under them shows through, and that under a background the pinned rows show exactly what the background shows in their place.
