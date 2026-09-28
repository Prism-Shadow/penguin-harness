# Loom imports bring their media, bound as Loom had it

- **Date:** 2026-09-23
- **Type:** feature
- **Scope:** `server`, `web`

Importing an activity from Loom now carries its media. Before, a ref arrived with no media
plan, and planning one left every asset unbound, although Loom had them all bound to
checkout media. Each imported ref is now planned from its specification and bound as Loom
had it, in every supported language.

## Details

- Each asset keeps Loom's path under `media/`, which the player already finds in the WAF
  checkout. A narration keeps its script, its word timings when they align with that script,
  and its length.
- A non-default language holds exactly what Loom listed for it, its translated narration.
  Pictures, music and effects fall back to the default, as in Loom. Adding a language now
  creates the same shape: the scripted narration, to translate.
- The import report names what Penguin cannot keep: per-narration voices, phonemes, timings
  that do not match their script, and paths outside `media/`. The migration trial against
  the real checkout checks that both languages arrive bound and that timings survive.
- The manifest accepts `wordTimings` and `durationMs` on narration. Any change to a
  narration's recording or words drops them, so a read-along never highlights by stale
  timings: accepted speech, an accepted or proposed script, an edited script, a rebinding
  or a trim.
- A spoken script's bracketed audio tags, such as `[pause]`, no longer count as words when
  timings are checked against it. Loom's scripts carry them, and counting them put every
  later timing on the wrong word.

## Fixes

- Validating a media manifest dropped a narration's `translatedFrom`, so saving media
  silently lost which English line a translation was made from.
- Speech coverage between languages counts only the default language's scripted narration.
  Before, it counted music and effects, which a language never translates.
