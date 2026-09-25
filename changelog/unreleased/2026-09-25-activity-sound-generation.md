# Generate music and sound effects from a prompt

- **Date:** 2026-09-25
- **Type:** feature
- **Scope:** `server`, `web`, `skills`

A Music or Sound effect asset in the asset editor gained **Prompt**, **Length** and
**Provider** fields and a **Generate** button. The new clip plays beside the current file
under "Current and new", and **Use new** binds it. Without an ElevenLabs key, the editor names
the Vault key to add. Uploading a file and choosing one from the library still work.

## Details

- A sound runs as an ordinary activity run with a Session. The run stages
  `generate-sound.mjs` (new in the `agent-development` plugin's `unified-llm-api` skill), and
  that helper makes one ElevenLabs request: `POST /v1/music` with model `music_v1` for music,
  or `POST /v1/sound-generation` for an effect, both as `mp3_44100_128`, with a 120 s timeout.
  The helper reads `ELEVENLABS_API_KEY` only from the Agent Vault environment and never
  echoes a response. A 401 or 403 is reported as "provider refused: plan or key".
- `POST /api/projects/:projectId/activities/:activityId/generate-sound`
  `{agentId, expectedRevision, language, assetKey, provider}` starts the run. It refuses
  narration, a prompt that is empty or over 2 000 characters, an unknown provider, a coding
  agent, and an agent whose Vault lacks the provider's key (`sound_credential_missing`, which
  names the key). Accepting uses the existing `accept-audio` route and refuses a take whose
  prompt was edited since (`audio_changed`).
- `GET /api/projects/:projectId/activities/sound-setup?agentId=` lists each sound provider
  with its kinds, models, Vault key, and whether the agent can use it (and if not, the
  problem code).
- The prompt is the asset's script. When the script is wrapped in Loom's
  `<audio kind="…">…</audio>` tag, the prompt is the tag's body, and editing the prompt keeps
  the tag. The requested length is the new optional `targetDurationMs` (1 000–60 000 ms).
  Planning media from a specification, and importing from Loom, both carry the tag's
  `duration` attribute (in seconds, clamped to 1–60) into `targetDurationMs`.
- MP3 output is kept as it is, with no transcoding. A new MP3 check reads an optional ID3v2
  tag, then MPEG audio frames back to back (an ID3v1 tag may close the file), and adds up the
  frame lengths. Anything else fails the run. An accepted sound is bound as
  `media/generated/<runId>.mp3` with `generatedAudio.format: "mp3"`. Its playback settings
  and requested length stay, and its recorded clip length is dropped. The run's audio route
  serves it as `audio/mpeg`, and assembly, version history and the assembly check read it
  in that format.
- `audio-providers.ts` gained the sound provider seam (`SOUND_PROVIDERS`,
  `soundProviderFor`, `soundSetup`). The existing worded capability report uses the same
  provider check. The seam offers only ElevenLabs; a model reached through the model hub is a
  provider id it knows but cannot use yet (`provider_unknown`).
- The `agent-development` plugin version went to `2026.09.25.1`.

## Compatibility

The new manifest fields are additive: `targetDurationMs` on an asset, and
`generatedAudio.format` on a bound clip. A record without `format` is WAV, as every existing
record is, and existing narration is unchanged. An older server rejects a media plan that
carries either field, so after a rollback, an activity with an accepted sound or a requested
length must have them removed from its media plan before that server will save it.
