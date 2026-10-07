# The preview loads behind the WAF character animation

- **Date:** 2026-09-29
- **Type:** feat
- **Scope:** `server`

While an activity preview starts, the player shows the character loading animation from
the WAF media checkout (`media/videos/loading/CharacterLoadingScreen.mp4`), the same file
Loom's dev-sandbox shows. It comes through the preview's media route, so nothing is copied
into Penguin. A checkout without the file, or with only its LFS pointer, keeps the plain
"Loading preview…" text. The video is paused once the activity starts.
