# Voice picker for narration, with one voice for every narration

- **Date:** 2026-09-25
- **Type:** feature
- **Scope:** `server`, `web`

An author chose a narration's voice from a picker that searches the voices by name or ID,
and saved that voice on the narration, so the voice stayed chosen for the next time that line
was generated. In **Audios**, one choice set a voice on every narration of the open language.

## Details

- `GET /api/projects/:projectId/activities/speech-setup` returned a `catalogue` beside
  `voices`: one entry per voice Penguin speaks with (Kore, Puck, Charon, Fenrir, Aoede), with
  its provider, model, languages (empty means every language), a preview URL (none for
  Gemini) and Gemini's style word for the voice. The catalogue was built from the same list
  speech generation accepts.
- A narration in the media manifest could carry `voice` (1-64 letters, digits, spaces, `_`,
  `.` or `-`). The manifest refused a voice on an image, video, music or sound effect with
  "Only a narration may name a voice." Choosing a voice kept the bound clip and its word
  timings, since that recording was made in the earlier voice; the picker said the new voice
  applies the next time the line is generated.
- The picker showed the result count, filters for provider, model and language only when a
  filter had two or more values, each voice's ID and details, and a Preview button only for a
  voice with a sample. Narrations with different voices showed **Multiple voices**.
- **Generate speech** in the asset editor, bulk generation, a retry, and the Speech stage of
  Run all stages spoke each narration in its own saved voice, and used the chosen default
  voice for a narration naming none (or naming one Penguin cannot speak with).
- **Voice for every narration** in Audios set the voice on every narration of the open
  language, and nothing else, and saved the manifest.

## Compatibility

The `voice` field was additive: manifests without it read and saved as before. A manifest
that names a voice was refused by an older server, which does not know the field, as a
manifest recording `translatedFrom` was. The App fell back to the bare `voices` list when a
server sent no `catalogue`.
