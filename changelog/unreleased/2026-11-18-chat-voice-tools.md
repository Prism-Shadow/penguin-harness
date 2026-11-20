# Choose the Project's multimodal models, dictate chat messages and hear replies

- **Date:** 2026-11-18
- **Type:** feature
- **Scope:** `web`, `ui`, `ui-gallery`, `plugins`, `desktop`
- **PR:** [#1598](https://github.com/Prism-Shadow/penguin-harness/pull/1598)

[中文版](2026-11-18-chat-voice-tools.zh.md)

Open **Multimodal models** from Models or Project settings to choose the Project's model for each operation. Image understanding comes first: it is the Project's vision model, which also reads images for models without vision. Below it is one row per tool-model binding the Project's enabled plugins declare (with the multimodal tools plugin: text generation, web search, page fetching, and image, video and speech generation and recognition), each with its name and a picker of the models that binding accepts. The `penguin tools` commands use these models. A change made in another tab or on another machine shows up at once.

Open a model in the library to choose it for an operation it serves: each operation is a row with **Set default**, or **In use** on its current model. The card itself carries no buttons, only a small mark whose tooltip names the bindings the model is in use for. The chat model picker leaves tool models out; the tool pickers list them.

With a speech recognition model chosen, click the microphone beside Send. While you record, the same button becomes **Finish recording**, and the toolbar's left side shows a cancel button, the elapsed time and a small level meter; Send and the other controls stay where they were. The recording is 16 kHz PCM WAV, which every speech recognition model takes. Finishing transcribes into the draft at the caret, and cancelling (or Escape) discards the recording. Turn on **Polish dictation** in Project settings to clean transcripts up with the Project's text generation model; you can edit its instructions or restore the defaults. If polishing fails, the original transcript is inserted.

With a speech synthesis model chosen, click the speaker on an assistant reply to listen, and again to stop. The audio is kept with the Session: reading the same reply with the same voice model again plays it without a new request, for any member. Leaving the conversation stops playback.

If an older draft names a tool model, it opens with the Project's chat model or the first available chat model; when none is available, the draft offers a link to Models and keeps your message.
