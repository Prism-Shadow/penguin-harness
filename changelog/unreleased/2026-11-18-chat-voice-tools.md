# Choose project tool models and dictate chat messages

- **Date:** 2026-11-18
- **Type:** feat
- **Scope:** `web`, `desktop`, `ui`
- **PR:** [#1598](https://github.com/Prism-Shadow/penguin-harness/pull/1598)

[中文版](2026-11-18-chat-voice-tools.zh.md)

In **Models → CLI and voice models**, assign any compatible configured model to image generation, video, speech synthesis, transcription, search or reading a URL. The list identifies each model by its provider and model ID. Assignments are shared with the CLI. Clear a selection to unassign it. A compatible model card has a button for its operation. Selecting a new model moves the current marker to that card immediately. Each project keeps its own six selections. Project members can see the current choice.

With a transcription model assigned, click the microphone beside Send. A small waveform in the toolbar shows the sound reaching your microphone. Choose **Finish recording** to transcribe into the draft, or **Cancel** to discard the recording. Escape also cancels. You can edit the draft before sending. Enable **Polish dictation** and choose a text model to clean up repetitions and punctuation. If polishing fails, the original transcript remains available in the draft.

With a speech synthesis model assigned, click the speaker on an assistant reply to listen. Click again to stop. Leaving the conversation stops playback and releases the audio.


Model cards list the operations supplied by active project plugins. Removing the provider hides its model selectors and chat voice controls. Enabling it again restores the saved selections.

Browser dictation converts the microphone recording to 16 kHz mono PCM WAV when the selected speech recognition model needs it.

Reading a reply again uses its saved audio for that listener, Session, text and voice model. A reload also reuses it. The playback control sits alongside Copy and Fork.
