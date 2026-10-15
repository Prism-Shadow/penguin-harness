# Streaming replies no longer lay a band over the custom background

- **Date:** 2026-10-15
- **Type:** fix
- **Scope:** `ui`, `web`

[中文版](2026-10-15-stream-transparent-background.zh.md)

With a custom background image set, a reply, a thinking step or a tool's output that is still
streaming now sits directly on the image, exactly as it does once it settles. Frost used to draw
its veil over the newest lines in the page's colour, which pressed a band of that colour across
the picture until the text finished. Over a background image no theme draws a layer on streaming
text any more; the words keep their pace and arrive at full ink. Without an image, Frost's veil is
unchanged.
