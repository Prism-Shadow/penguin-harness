# Choose project tool models and dictate chat messages

- **Date:** 2026-11-18
- **Type:** feat
- **Scope:** `web`, `desktop`, `ui`
- **PR:** [#1598](https://github.com/Prism-Shadow/penguin-harness/pull/1598)

[中文版](2026-11-18-chat-voice-tools.zh.md)

In **Models → CLI and voice models**, assign any compatible configured model to image generation, video, speech synthesis, transcription, search or reading a URL. The list identifies each model by its provider and model ID. Assignments are shared with the CLI. Clear a selection to unassign it. A compatible model card has a button for its operation. Selecting a new model moves the current marker to that card immediately. Each project keeps its own six selections. Project members can see the current choice.

With a transcription model assigned, click the microphone beside Send. Finish the recording to insert its text at the cursor. Escape cancels the recording. You can edit the draft before sending. Enable **Polish dictation** and choose a text model to clean up repetitions and punctuation. If polishing fails, the original transcript remains available in the draft.

With a speech synthesis model assigned, click the speaker on an assistant reply to listen. Click again to stop. Leaving the conversation stops playback and releases the audio.

