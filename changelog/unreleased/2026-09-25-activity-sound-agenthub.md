# Music and sound effects through a model hub model

- **Date:** 2026-09-25
- **Type:** feature
- **Scope:** `server`, `web`, `skills`

The sound editor's **Provider** list now also offers **Model**: a music or sound model
reached through the model hub (`@prismshadow/agenthub`), which uses the key already in the
agent's Vault for that model's provider. agenthub 0.4.15 has no music or sound model, so the
option is shown disabled with the reason: "No music or sound model is available through the
model hub in this version." It is never hidden and never replaced by another provider. When
the hub offers several models for a kind, a **Model** picker appears beside the provider.

## Details

- The hub's sound models are listed in a catalogue (`sound-models.ts`,
  `AGENTHUB_SOUND_MODELS`), which is empty in this build. Each entry gives the model id, the
  kinds it makes, the Vault key its provider reads, the format it returns (`wav` or `mp3`),
  and the first agenthub release that carries it. An entry newer than the pinned agenthub
  release (`AGENTHUB_VERSION`, 0.4.15) is not offered. Adding a model later needs only a
  catalogue entry and, if the model needs one, a newer agenthub pin.
- `GET /sound-setup` lists `agenthub` after ElevenLabs, with `modelChoices` (each model's
  id, kinds, key, and whether the agent holds it). While the catalogue is empty, it reports
  `available: false, problem: "no_model"`.
- `POST /generate-sound` accepts an optional `model`. For `provider: "agenthub"` it refuses
  with 409 `sound_no_model` while the hub has no model for the asset's kind, and with 400
  `sound_model_unknown` for a model the provider does not offer. A missing key is still
  `sound_credential_missing`, naming the key.
- A hub run stages `generate-sound.mjs` with `@prismshadow/agenthub` in the workspace's
  `package.json`. The ElevenLabs branch still installs nothing, and the helper loads agenthub
  only for a hub run. The helper streams one request and joins the inline audio: MPEG audio
  becomes `sound.mp3`, and a single WAV or raw 24 kHz mono PCM becomes `sound.wav`. Any other
  audio type, mixed types, audio in another format than the model's catalogued one, or an
  unfinished stream fails the run, and nothing is written.
- Collection reads only the file for the run's format: `sound.mp3` for ElevenLabs, and the
  catalogued format for a hub model. A run that leaves the other file fails, so a WAV in an
  ElevenLabs run's workspace is never offered as its take. `sound.wav` gets the same check as
  speech.
- When a request names no model, the hub picks the first model for the kind whose key the
  agent holds, the same model `GET /sound-setup` reports for that kind. An accepted WAV sound is bound as `media/generated/<runId>.wav`, with no
  `generatedAudio.format`.
- The `agent-development` plugin version went to `2026.09.25.2`.
