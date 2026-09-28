# Speak narration with Gemini or ElevenLabs, with word timings from ElevenLabs

- **Date:** 2026-09-25
- **Type:** feature
- **Scope:** `server`, `web`, `skills`

A narration in the asset editor gained a **Provider** field: Gemini, as before, or
ElevenLabs. The voice picker lists that provider's voices. An ElevenLabs recording comes back
with the time each word starts and ends, so accepting it records **Word timings** and the
clip's length, and the book highlights each word as it is spoken without a separate alignment
step. The editor lists the accepted recording's words and marks the one being spoken as the
clip plays. A Gemini recording records no timings and says so.

## Details

- The provider is saved on the narration as the new optional `speechProvider`
  (`"gemini" | "elevenlabs"`). A narration that names none is spoken by Gemini. A provider the
  chosen agent has no key for is listed but disabled, with the key it needs (for example,
  "ElevenLabs (needs ELEVENLABS_API_KEY)").
- ElevenLabs voices are the agent's Vault `ELEVENLABS_VOICE_ID`, offered as "ElevenLabs
  default", and any voice ID an author types (10 to 40 letters and digits). Penguin does not
  list the ElevenLabs voice library over the network, so the only paid call is the one an
  author starts with **Generate speech**. The server reads Vault key names only. The helper
  reads the voice ID from its own environment.
- `POST …/generate-audio` takes an optional `provider` and `model` (`eleven_v3`, the
  default, or `eleven_multilingual_v2`). When `provider` is absent, the narration's own
  provider is used. A narration set to ElevenLabs on an agent without `ELEVENLABS_API_KEY` is
  refused with `speech_credential_missing`, and the message names the key. Penguin never
  substitutes Gemini. The Vault default voice without `ELEVENLABS_VOICE_ID` is refused with
  `speech_voice_missing`.
- `GET …/speech-setup?agentId=` also returns `providers`: `{id, credential, available,
  problem?, timings}` for each provider. With an agent whose Vault holds
  `ELEVENLABS_VOICE_ID`, the catalogue also lists the default ElevenLabs voice. Catalogue
  entries now carry `providerId`. Without `agentId`, the response is as before.
- `generate-speech.mjs` (in the `agent-development` plugin's `unified-llm-api` skill) gained
  an ElevenLabs branch. It makes one `POST /v1/text-to-speech/<voice>/with-timestamps` request
  as `mp3_44100_128` with Node's built-in `fetch`, then writes `speech.mp3` and
  `speech-timings.json`. The per-character alignment is grouped into one
  `{word, startMs, endMs}` per spoken word, counted the way the server counts words: bracketed
  audio tags are skipped, and apostrophes and hyphens stay part of a word. A 401 or 403 is
  reported as "provider refused: plan or key". The Gemini branch is unchanged. It now loads
  agenthub only when Gemini speaks, so an ElevenLabs run installs nothing.
- Collection takes `speech.wav` from Gemini or `speech.mp3` from ElevenLabs. If a run writes
  the other provider's file, the run fails. Timings are checked against the script's spoken
  words before the clip is kept, and timings that do not fit fail the run. Accepting writes
  `wordTimings` and `durationMs` only when the recording has timings.
- The Stages run's speech step speaks each narration with its own provider. For ElevenLabs
  it uses the narration's voice, else the Vault default.
- In **Audios**, a **Provider for every narration** picker sets one provider on the
  language's narrations. Choosing a voice for every narration also sets that voice's
  provider.
- The `agent-development` plugin version went to `2026.09.25.3`.

## Compatibility

`speechProvider` on a narration and `provider` on a run's audio target are new optional
fields. A narration or run record without them is Gemini's, so existing manifests and runs
behave exactly as before. An older server rejects a media plan whose narration names a
provider. After a rollback, remove `speechProvider` from those plans before that server will
save them.
