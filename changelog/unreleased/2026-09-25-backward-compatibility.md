# Product tags and activity versions tables

- **Date:** 2026-09-25
- **Type:** refactor
- **Scope:** `server`

Migration 20 (`activity-product-tags`) added the `activity_product_tags` table for product
tags, and migration 21 (`activity-versions`) added the `activity_versions` table for
[saved activity versions](2026-09-25-activity-versions.md). Neither rewrote any existing row.

## Compatibility

Migration 20 is swap-safe: a pushed platform applies it without a restart, and an older
build neither reads nor writes the new table. Rolling it back drops the table and loses only
the tags. Deleting an activity sets the existing `activities.archived` column, which every
earlier reader already skips, so an older build does not list deleted activities either.

Migration 21 is swap-safe in the same way: an older build neither reads nor writes the table.
Rolling it back drops the table and loses the version list; the version blobs stay on disk,
where nothing reads them.

Two optional media-plan fields arrived with [sound generation](2026-09-25-activity-sound-generation.md):
`targetDurationMs` on a music or sound-effect asset, and `generatedAudio.format` (`"mp3"`) on
a bound sound. Neither rewrote an existing record, and a bound clip without `format` is read
as WAV, as before. An older build rejects a media plan that carries either field, so rolling
back needs them removed from the plans that have them.

A narration's optional `speechProvider` arrived with [speech providers](2026-09-25-activity-speech-providers.md).
It did not rewrite any existing record. A narration or a run without a provider is read as
Gemini's, as before. An older build rejects a media plan that names a speech provider, so
rolling back needs the field removed from the plans that have it.

A decodable book's word pronunciations arrived with [book words](2026-09-25-activity-book-words.md):
the optional audio fields `role`, `word`, `normalizedWord`, `phonemes`, `phonemeSource` and
`customized`, and the run kind `phonemes`. They did not rewrite any existing record, and a
media plan without them reads as before. An older build rejects a media plan that holds a
word asset, so rolling back needs the word assets removed from the plans that have them. An
older build lists a `phonemes` run by its kind alone.

[Word recordings](2026-09-25-activity-word-recordings.md) added the optional word-asset fields
`customScript`, `phonemeTimings` and `wholeWordTiming`, and the pipeline step `words`. They
did not rewrite any existing record, and a media plan without them reads as before. An older
build rejects a media plan that holds any of them, so rolling back needs them removed from
the plans that have them. A word's `script` is now written from its sounds when the plan is
saved; an older build keeps it as an ordinary script.
