# A builtin Media Agent makes every activity's speech, sound and images

- **Date:** 2026-10-07
- **Type:** feat
- **Scope:** `core`, `server`, `web`, `activities`

Every Project now has a second builtin Agent, the **Media Agent** (`media_agent`), next to the General Agent. Like the General Agent it cannot be deleted. A Project created before this change gets the Media Agent the next time its Agents list loads or an activity asks about speech or sound.

Activity speech, word recordings, music, sound effects and images always run on the Media Agent, whichever agent or coding agent runs the other stages. Their provider keys (`GEMINI_API_KEY`, `ELEVENLABS_API_KEY`, `ELEVENLABS_VOICE_ID` and the model hub keys) belong in the Media Agent's Vault, and the Provider pickers show what that Vault allows. Choosing a coding agent no longer skips or disables media generation. The script, specification, translations, assessment, tests and module still run on the agent you choose.

The Media Agent's AGENTS.md states its role: run the helper the run names, never change the prompt, provider, model or voice, stop when the helper fails, and never repeat a Vault value.

Activity media now has a house style for children aged 3 to 8, kept in one place (`packages/server/src/activities/media-style.ts`):

- Every generated image is drawn in it: simple flat illustration, one clear subject, and no words, letters or labels unless the description asks for them. The image request no longer names the asset key, so the key is never drawn into the picture.
- Gemini reads narration warmly and clearly at an unhurried pace. Word pronunciations still follow their own direction. ElevenLabs is unchanged.
- **Improve narration script** writes in the house style, and improving an image prompt describes the picture and leaves its drawing style to the image run.

ElevenLabs narration works without `ELEVENLABS_VOICE_ID`: the default voice is Loom's narration voice (`EXAVITQu4vr4xnSDxMaL`), and a voice set in the Media Agent's Vault still overrides it. "No ElevenLabs voice yet" no longer appears for a Vault without one.

The voice picker lists the Media Agent's ElevenLabs voice library, as Loom's does: every voice on the account with its name, preview, verified languages and labels, searchable and filterable. The default comes first and is named after the voice it stands for, for example "ElevenLabs · Default voice (Sarah)". The server reads the list from ElevenLabs with the Media Agent's `ELEVENLABS_API_KEY`, which goes to ElevenLabs and nowhere else, and keeps it for ten minutes. **Reload voices** reads it again. When the list cannot be read, the editor says why, and the default voice and typed voice IDs still work.

The `agent-development` plugin is now version 2026.10.08.1: its image and speech helpers take an optional `style`, and the speech helper takes a `defaultVoice` for a Vault without `ELEVENLABS_VOICE_ID`.

**New ref** no longer asks which agent generates the new ref's speech and images.

Keys already in another agent's Vault are not moved. Add them to the Media Agent's Vault once.
