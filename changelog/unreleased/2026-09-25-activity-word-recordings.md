# Record a decodable book's words, timed sound by sound

- **Date:** 2026-09-25
- **Type:** feature
- **Scope:** `server`, `web`

In a decodable book, **Record words (n)** in the Audios section records every word
pronunciation that has sounds and no recording yet. Each clip says the word slowly, sound by
sound, and then says it normally. With ElevenLabs the recording's timings are shared out into
a start and end for each sound and for the whole word. The assembled book receives them, so
the reader highlights the word sound by sound. Opening a word shows the script it is recorded
from, its recording, and a sound timeline whose sounds light up in turn as the recording plays.
The Build stage warns about words still without a recording or without timings.

## Details

- A word's script is made from its sounds for its provider. ElevenLabs (model `eleven_v3`)
  gets `[very slowly] [drawn out] "/<sounds, first vowel held with ːːː>/" [short pause]
  <word>.`, which is Loom's script. Gemini, which reads no IPA, is asked in plain words: "Say
  the word '<word>' very slowly, stretching each sound: <sounds>, then say it normally." The
  script is written again whenever a word's sounds or provider change: on refresh, when sounds
  are saved or accepted, and when the media plan is saved. **Write my own script** keeps the
  author's script as written, marked by the new optional field `customScript`. **Use the
  script from its sounds** returns the word to the made script.
- When a word's script changes, a generated recording made from the old script is unbound
  with its timings, so the next **Record words** records the word again. An uploaded file is
  kept.
- The pipeline has a new `words` step after `speech`, also available on its own as
  `stage: "words"`, for one language with `language`. It runs only for a decodable book: the
  product's reading mode decides, then the run's `bookMode`, and a book that already lists
  word pronunciations counts as decodable. Each word is recorded by the ordinary speech run
  and accepted. A word that names no provider is given ElevenLabs when the agent's Vault has
  `ELEVENLABS_API_KEY`, and Gemini otherwise, and keeps that choice. Skipped steps carry the
  notes `notDecodable`, `needsPenguinAgent`, `noWords` or `wordsMissingSounds`. The page asks
  before starting, because every recording is a paid request.
- Accepting a word's recording that has exactly two word timings (the drawn-out sounds, then
  the word) stores the optional fields `phonemeTimings` (`[{phoneme, startMs, endMs}]`, the
  slow span shared evenly between the sounds) and `wholeWordTiming` (`{startMs, endMs}`). A
  Gemini recording has no timings and records neither; nothing is estimated.
- The compiled book configuration of a decodable book gives each story page's narration a
  `words` list: `{text, normalizedWord, audioKey, phonemes, phonemeTimings: [{phoneme, start,
  end}], wholeWordTiming: {start, end} | null}`, in seconds, from the language's word assets,
  as Loom compiled it. A word imported from Loom with only its two word timings is timed the
  same way. `audioKey` is the word asset's key, which the language group binds to the clip's
  versioned media URL. Read-along books compile as before, with no words.
- Build readiness has a new `words` check per language for a decodable book:
  `{language, recorded, total, timed}`. It warns when a word lacks a recording or timings,
  and when a decodable book lists no words in its default language.
- `customScript`, `phonemeTimings` and `wholeWordTiming` stay in Penguin's media plan. They are
  left out of the asset manifest written into the WAF module, which receives the timings
  through the book configuration.
