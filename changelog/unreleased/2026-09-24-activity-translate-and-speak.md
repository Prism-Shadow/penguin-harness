# Translate and speak a language in one step

- **Date:** 2026-09-24
- **Type:** feat
- **Scope:** `server`, `web`

In speech coverage, a language whose narration has no script yet now offers **Translate and
speak**, for one line or for all of them. It translates each line from the default
language, accepts the translation, then generates and accepts the speech, as the
Translate and Generate speech stages would one after the other. A line that already has
speech and whose English changed still offers **Translate**, which only updates its words.

The stages endpoint (`POST …/pipeline`) accepts `stage: "narration"` (translations, then
speech) and an optional `language`, and `assetKey` within it, which limit the media steps
to that language or that one line. The run's state reports the limit as `scope`. The
bulk **Translate N** button in a language now translates only that language.
