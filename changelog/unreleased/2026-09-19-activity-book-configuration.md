# Compile localized book configuration for WAF assembly

- **Date:** 2026-09-19
- **Type:** feature
- **Scope:** `server`, `web`
- **PR:** [#23](https://github.com/nicolaepocroianu/penguin-harness/pull/23)

Book assembly gained an explicit Read-along or Decodable choice. Each new run recorded its selected mode and staged a native WAF book policy with ordered localized scenes, cover/title roles, story page numbers, image descriptions, primary narration, and follow-up audio cues. Incomplete localized narration fell back to the complete default-language configuration.

Collection rejected changes to the selected reading policy or compiled page data. Decodable assembly required final-story narration with an audio binding. Missing alignment and word-pronunciation data remained explicit gaps rather than fabricated timing metadata.

Existing activity drafts and history were not rewritten. Reading mode became a choice for each new book assembly rather than a saved activity default; no database migration was added. This change prepared book inputs for generation without adding a complete native reader implementation.
