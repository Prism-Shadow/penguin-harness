# Ship the native book reader adapter

- **Date:** 2026-09-20
- **Type:** feature
- **Scope:** `server`

Book assembly now stages the complete native WAF reader alongside the model and coordinator: a typed DOM view with accessible controls, artwork, story text and word spans; an adapter that compiles word-highlight events only from timings the configuration actually carries and wires framework pause/resume plus pagehide teardown; and a book entry that boots the waf-state-machine with intro video, native timed-audio operations, keyboard navigation, and completion through `BOOK.COMPLETED` while the reader stays interactive for Previous and rereading.

Book product configuration now embeds the book state machine and the reader scene catalog, and assembly verifies both survive unchanged. The scaffold applies token replacement to the staged reader sources.

Word alignment stays honest end to end: with the currently empty timing arrays narration plays without highlighting, a missing cue rejects as failed narration instead of resolving as success, and word taps without word audio announce the gap instead of faking playback.
