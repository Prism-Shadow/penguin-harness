# Speech and sounds are generated without an agent

- **Date:** 2026-10-08
- **Type:** feat
- **Scope:** `server`, `web`, `core`, `docs`

Narrations, decodable-book word recordings, music and sound effects no longer start a Media
Agent Session. The server runs the staged helper itself (`generate-speech.mjs` or
`generate-sound.mjs`) in the run's workspace, the way Loom's audio stage calls its
provider. That holds for each clip of the pipeline's speech, words and sounds steps and for
a single **Generate** in the media editor. The Media Agent's Vault is the helper's only
source of provider keys; the server's own environment copies are removed first. ElevenLabs
needs no install. Gemini speech and hub sound models need agenthub, which is now installed
once per version under `<data root>/media-helper-cache` and linked into each run's workspace
as its `node_modules`, instead of being installed again for every clip. Runs that start
together share one install, and a failed install leaves nothing behind, so the next run
tries again. A new install removes the versions it supersedes (the previous agenthub once
`AGENTHUB_VERSION` is raised) and scratch installs a crash left more than an hour ago; a
folder still in use is kept and tried again after the next install.

What the helper writes is collected and checked as before. The clip is stored as an MP3
candidate, ElevenLabs word timings must fit the script, a stray file from another provider
or format fails the run, and a draft edited mid-run is a conflict. A failed run carries the
helper's own last line, for example `provider refused: plan or key`. Stopping the run stops
the helper.

An accepted narration now records the model and voice it was spoken with
(`generatedAudio.model` and `generatedAudio.voice`), as Loom's sidecar fingerprint does.
The speech step makes a bound narration again when the model or voice it would use now
differs: a model or voice chosen in the editor, a new provider, a new default model, or,
for a narration with no voice of its own, another voice chosen for the run. The default
ElevenLabs voice is resolved when a run starts, as Loom does: the Media Agent's Vault
`ELEVENLABS_VOICE_ID` when it names a voice, else Loom's built-in voice. The helper is
handed that voice and the clip records it, so changing the Vault's default voice makes the
narrations that use it again. Clips accepted before this record neither and stay bound, so
nothing existing is regenerated. Sounds record neither, as in Loom.

The run panel says a speech or sound stage has no session to show, instead of waiting for
one. Images are still made by Media Agent Sessions.
