# Choose project tool models and dictate chat messages

- **Date:** 2026-11-18
- **Type:** feature
- **Scope:** `web`, `ui`, `ui-gallery`, `server`, `desktop`
- **PR:** [#1598](https://github.com/Prism-Shadow/penguin-harness/pull/1598)

[中文版](2026-11-18-chat-voice-tools.zh.md)

Open **Multimodal models** from Models or Project settings to choose models for text generation, image understanding, search, fetching URLs, and image, video and speech tools. Each operation is one row: its name and a picker; what the page is for sits behind the heading's "?". The chat model picker shows compatible models grouped by provider for each tool. Its selection applies to the project’s `penguin tools` commands. Dictation and read-aloud share the selected voice models. On phones, Project settings brings the selected tab into view when you open it.

With a transcription model assigned, click the microphone beside Send. While you record, the same button becomes **Finish recording**, and the toolbar’s left side shows a cancel button, the elapsed time and a small level meter; Send and the other controls stay where they were. Finishing transcribes into the draft at the caret, and cancelling (or Escape) discards the recording. You can edit the draft before sending. Turn on **Polish dictation** in these project settings to clean transcripts up with the project’s text generation model; polishing has no model of its own. You can edit the instructions, save them for this project, or restore the defaults. If polishing fails, the original transcript remains available in the draft.

With a speech synthesis model assigned, click the speaker on an assistant reply to listen. Click again to stop. Leaving the conversation stops playback and releases the audio.

Project settings list the operations supplied by active server plugins. Removing the provider hides its model selectors and chat voice controls. Enabling it again restores the saved selections.

Browser dictation converts the microphone recording to 16 kHz mono PCM WAV when the selected speech recognition model needs it.

Reading a reply again uses its saved audio for that listener, Session, text and voice model. A reload also reuses it. The playback control sits alongside Copy and Fork.

Open a model in the library to make it the Project’s model for an operation it serves: each operation is a row with **Set default**, or **In use** on its current model. The card itself carries no buttons, only a small mark whose tooltip names the operations the model is in use for. Choosing another speech recognition model replaces the previous one and keeps the chat model. If an older draft names a tool model, it opens with the project’s chat model or the first available chat model. When none is available, the draft offers a link to Models and keeps your message.
