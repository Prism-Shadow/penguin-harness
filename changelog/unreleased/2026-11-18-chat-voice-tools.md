# Choose project tool models and dictate chat messages

- **Date:** 2026-11-18
- **Type:** feat
- **Scope:** `web`, `desktop`, `ui`
- **PR:** [#1598](https://github.com/Prism-Shadow/penguin-harness/pull/1598)

[中文版](2026-11-18-chat-voice-tools.zh.md)

Open **Default multimodal models** from Models or Project settings to choose models for text generation, image understanding, search, fetching URLs, and image, video and speech tools. Replacing or clearing a choice affects this project’s chat and CLI.

With a transcription model assigned, click the microphone beside Send. A small waveform in the toolbar shows the sound reaching your microphone. Choose **Finish recording** to transcribe into the draft, or **Cancel** to discard the recording. Escape also cancels. You can edit the draft before sending. Open **Polish dictation** in these project settings to enable cleanup with the project’s text generation model. You can edit the instructions, save them for this project, or restore the defaults. If polishing fails, the original transcript remains available in the draft.

With a speech synthesis model assigned, click the speaker on an assistant reply to listen. Click again to stop. Leaving the conversation stops playback and releases the audio.

Project settings list the operations supplied by active server plugins. Removing the provider hides its model selectors and chat voice controls. Enabling it again restores the saved selections.

Browser dictation converts the microphone recording to 16 kHz mono PCM WAV when the selected speech recognition model needs it.
