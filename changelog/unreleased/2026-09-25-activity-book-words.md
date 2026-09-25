# List a decodable book's words with their sounds

- **Date:** 2026-09-25
- **Type:** feature
- **Scope:** `server`, `web`

In a decodable book, **Refresh words** in the Audios section lists every distinct word the
story pages' narration shows. Each word becomes a Word pronunciation asset under each scene
that shows it, and its sounds (phonemes) come from espeak-ng when the server has it. For
words espeak-ng cannot sound out, **Ask a model for the rest** starts a model run that
proposes sounds. The proposal is listed, and **Use these sounds** gives the proposed sounds
to the words that still have none. In the hierarchy, a scene's words appear under a
**Word pronunciations** group after its Audios. Opening a word shows the word and its sounds
as small editable boxes. **Save sounds** makes the word the author's, and a refresh never
replaces an author's word, even after the story stops using it.

## Details

- A word asset is an audio asset with the new optional fields `role: "bookWord"`, `word`,
  `normalizedWord`, `phonemes` (up to 32 IPA segments of 1 to 8 characters, no stress marks),
  `phonemeSource` (`"espeak" | "model" | "author"`) and `customized`. They are allowed only
  together on audio. Words, normalized words, per-scene usages and keys
  (`book-word-<slug>-<sha256[:10]>`) follow Loom's rules, so the words of an imported book
  line up: a word is a run of letters and digits that an apostrophe (straight or curly) may
  join to another run, so dashes and ellipses separate words, and words are case folded
  ("Straße" is "strasse"). A word with letters outside ASCII gets its accents removed from the slug, because
  the manifest accepts only ASCII keys; the hash is still taken from the word.
- espeak-ng is a host program and is not bundled. The server runs `espeak-ng` from `PATH`, or
  the program an admin sets with `PUT /api/admin/activity-phonemes` `{espeakPath}`. It starts
  the program without a shell, one word per call, with `-q --ipa -v <voice> --sep=" "` and a
  5-second limit. English uses `en-us` unless the language code is British. When espeak-ng is
  missing, every word is reported as missing and the Audios section says so; no sounds are
  made up. `GET …/activities/book-words/setup` reports `{espeak: {available, version}}`.
- Routes: `GET …/:activityId/book-words` (the product's reading mode and espeak-ng's status),
  `POST …/:activityId/book-words/refresh` `{language, expectedRevision, bookMode?}` returning
  `{draft, missing}`, `PUT …/:activityId/book-words/:assetKey/phonemes`
  `{phonemes, expectedRevision, language?}`, `POST …/:activityId/generate-phonemes`
  `{language, words (up to 200), agentId | codingAgentId, expectedRevision}`, and
  `POST …/:activityId/runs/:runId/accept-phonemes` `{expectedRevision}`.
- Refresh is refused with `409 not_decodable` for anything that is not a decodable book. The
  product's recorded reading mode decides. `bookMode` in the request counts only when the
  product records none, and a successful refresh then records it on the product, so the
  choice holds after a reload.
- A phonemes run (`kind: "phonemes"`) is an ordinary traced run. It is handed
  `phonemes-input.json` and must write `phonemes.json` `{word: [segments]}`. A word it was not
  asked about, or segments that are not sounds, fail the run. Accepting the proposal fills
  only words that still have no sounds and that the author has not customized.
- Rebuilding the media plan keeps a book's words. Usages of removed scenes are dropped, and so
  is a word left in no scene, unless the author customized it.
- Import carries Loom's word pronunciations, with their sounds, under the key a refresh would
  give them. Sounds on any other asset are still named as dropped.
- Narration counts in Audios and in the Build stage's readiness no longer count the book's
  words. Recording the words is a later step.
