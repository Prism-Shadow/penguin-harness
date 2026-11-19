# Choose project tool models and dictate chat messages

- **Date:** 2026-11-18
- **Type:** feat
- **Scope:** `web`, `desktop`, `ui`
- **PR:** [#1598](https://github.com/Prism-Shadow/penguin-harness/pull/1598)

[中文版](2026-11-18-chat-voice-tools.zh.md)

Open **Default multimodal models** from Models or Project settings to choose models for text generation, image understanding, search, fetching URLs, and image, video and speech tools. The chat model picker shows compatible models grouped by provider for each tool. Its selection applies to the project’s `penguin tools` commands. Dictation and read-aloud share the selected voice models. On phones, Project settings brings the selected tab into view when you open it.

With a transcription model assigned, click the microphone beside Send. A small waveform in the toolbar shows the sound reaching your microphone. Choose **Finish recording** to transcribe into the draft, or **Cancel** to discard the recording. Escape also cancels. You can edit the draft before sending. Open **Polish dictation** in these project settings to enable cleanup with the project’s text generation model. You can edit the instructions, save them for this project, or restore the defaults. If polishing fails, the original transcript remains available in the draft.

With a speech synthesis model assigned, click the speaker on an assistant reply to listen. Click again to stop. Leaving the conversation stops playback and releases the audio.

Project settings list the operations supplied by active server plugins. Removing the provider hides its model selectors and chat voice controls. Enabling it again restores the saved selections.

Browser dictation converts the microphone recording to 16 kHz mono PCM WAV when the selected speech recognition model needs it.

Reading a reply again uses its saved audio for that listener, Session, text and voice model. A reload also reuses it. The playback control sits alongside Copy and Fork.

On a dedicated model’s card, select it as the Project default for that operation. Choosing another speech recognition model replaces the previous one and keeps the chat model. If an older draft names a tool model, it opens with the project’s chat model or the first available chat model. When none is available, the draft offers a link to Models and keeps your message.

The model library and the tool picker show the provider’s price in its original currency and billing unit, including any current offer. Open a model to see the input and output rates separately.

Jina Search and Reader show the MMSP reference rate on their official endpoints, with a link to the provider’s account plans.
