# Languages and translation for activities

- **Date:** 2026-09-23
- **Type:** feature
- **Scope:** `server`, `web`

An activity can now be translated. A language from Loom's table (Spanish, Romanian) can be
added, and each narration's script is translated before it is spoken. As in Loom, the
translation is text an author can read and correct before any audio exists.

## Details

- `POST /api/projects/:projectId/activities/:activityId/languages` with
  `{language, expectedRevision}` adds a language to the media plan. As in Loom, the new
  group holds only the scripted narration, without its script, so each line reads as
  needing translation rather than passing English off as translated. Pictures, music and
  effects fall back to the default. `GET …/activities/language-setup` returns the language
  table.
- `generate-media-text` takes `translate: true` to translate a narration's default-language
  script. Accepting the translation records that script on the asset as `translatedFrom`.
  If the English line is rewritten, the translation shows as out of date. A translation
  whose English changed while it ran is refused.
- The manifest accepts an optional `translatedFrom` on narration. Existing manifests are
  unaffected.
- **Run all stages** gained a **Translate** stage between planning media and generating
  speech. It translates and accepts every narration a language lacks, or whose English line
  changed. A script written by hand, with no recorded source, is left alone.
- Speech coverage marks each narration in a translated language as **Needs translation**,
  **English changed** or **Translating…**. Each row has **Translate**, and there is
  **Translate N**, which runs the stage, and **Add a language**. The asset editor offers
  **Translate** beside **Improve narration script**.
