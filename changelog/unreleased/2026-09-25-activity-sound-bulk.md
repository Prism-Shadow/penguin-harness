# Generate every missing sound, in Run all stages or from Audios

- **Date:** 2026-09-25
- **Type:** feature
- **Scope:** `server`, `web`

Run all stages has a new **Generate sounds** stage after **Generate speech**. It generates
and keeps every music and sound-effect asset that has a prompt and no file, one ordinary
sound run each, with ElevenLabs unless the sequence names another provider. The Audios
section (Speech coverage) shows a **Sounds** block for a language that has music or
effects: how many are bound, each one's state (Bound, Missing, Failed, Generating…, No
prompt), and **Generate missing sounds (n)**. It asks first, naming the provider, because
each sound is a paid request.

## Details

- The stage is skipped, not failed, with a note the App words: "No music or sound effect is
  missing." (`noSounds`) when there is nothing to make, and "The sound provider cannot be
  used by this agent." (`soundProviderUnavailable`) when the provider has no key or no model
  for the chosen agent. The provider is checked once, before the first sound. A coding agent
  skips it with `needsPenguinAgent`, as for speech and images.
- A sound counts as missing when it is audio with a playback kind (music or sound effect),
  has no file, and its prompt (the script, or the body of Loom's `<audio>` tag) is 1 to
  2 000 characters.
- `POST /:activityId/pipeline` accepts `stage: "sounds"` and an optional `soundProvider`
  (`elevenlabs` or `agenthub`); anything else is a 400. The Audios button starts the stage
  scoped to the open language, with the first provider the agent can use (ElevenLabs when
  its key is present).
- Narration stages are unchanged. The "Translate and speak" and "Generate speech and
  images" selections do not include the new stage.
