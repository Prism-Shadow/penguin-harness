# Scene audio is edited in every language at once, as in Loom

- **Date:** 2026-10-08
- **Type:** feature
- **Scope:** `web`, `server`, `activities`

Selecting a narration, music or sound effect in Scenes and media now shows one card for each language that has it, the default language first. Each card has its own **Generate audio** (**Regenerate audio** once the language has audio), **Save** and **Upload audio** buttons.

The header switches between two views. **Simplified**, the default, shows each language's voice, script and audio player. **Advanced** adds the audio type, the provider, the voice ID field and the ElevenLabs model. It also shows the current audio beside its candidate, the media path and library, word timings and script help.

Script, voice and settings still save as you edit. **Save** is the one deliberate step: it makes the card's candidate that language's audio. The candidate is the newest generated take, an uploaded file or a trimmed clip. Uploading or trimming no longer replaces the audio straight away. The new file becomes the candidate, so you can listen before saving it. Generating again replaces the candidate. Earlier takes stay in Generation History.

A language whose script is still empty offers **Translate from** the default language instead of Generate. The translation appears on its card for you to accept.

ElevenLabs narration can be spoken with Eleven v3 (the default), Eleven v4 or Eleven Multilingual v2. The model is chosen per narration in the Advanced view and saved with it. Single runs and the narration stage both use it.
