# A request that gives up ends the run like a stop does, errors stay in sight, and Retry is text

- **Date:** 2026-10-29
- **Type:** fix
- **Scope:** `ui`, `web`, `ui-gallery`
- **PR:** [#1386](https://github.com/Prism-Shadow/penguin-harness/pull/1386)

[中文版](2026-10-29-retry-row-style.zh.md)

A model request that failed all its attempts now ends the run the way a stop or a fatal error does: one muted line in the conversation, "[Failed]: all 6 requests failed (network or service temporarily unavailable): <the provider's message>", in the same shape as "[Aborted]: aborted during reconnect backoff", with Retry after it. Provider errors are no longer hidden behind a "?", and every retry press is a text action rather than a boxed button. A conversation whose history could not be read no longer says so in red, colon-joined text.

## Details

- The line a ladder that gave up ends with replaces the old retry row with its red cross: a bracketed label, how many attempts failed and why, then the provider's own message. A long message is clamped to three lines with Expand, on this line and on the "[Aborted]" and "[Error]" lines alike.
- While a request is being retried, its row in the conversation (in the transcript's one-line note frame) shows the cause and the provider's words after the sentence in the muted ink, clamped to two lines with Expand.
- A new shared text action (`TextAction`) is every press here: Retry on the lines a run ends on, Retry now and Stop retrying, the retry rows on machine cards and in the Machine dialog, Retry and Go to Machines on a failed history load, and Expand. It is a real button styled as text, in the link ink with an underline on hover; a one-line switch (`TEXT_ACTION_LOOK`) turns every one into the bracketed form, "[Retry]".
- The shared retry row (`RetryStatus`) sets its sentence at the body weight, in the body ink while an attempt is running or waiting and in the muted ink once it has stopped, never in the danger ink. Its mark sits in a box of one width, and the countdown's seconds keep the width of the wait's widest number, so neither the sentence nor the row's edge moves when an attempt settles or the seconds go from 10 to 9. In a conversation it renders through `TranscriptNoteFrame`, the note's box and head that `TranscriptNote` now renders through too; in a narrow column its presses wrap under the sentence, and in Frost and Console hovering it no longer darkens its words.
- A new shared notice, `LoadFailed`, stands in for content that could not be loaded. When a conversation's history fails to load, the chat shows the danger cross, "Could not load the message history", the error on its own muted line, and Retry. A conversation on a machine that is out of reach uses the same notice with the machine's glyph.
- When earlier messages fail to load at the top of a conversation, the chat shows the shared retry row with the error after the sentence and Retry, instead of a red sentence that was itself the button. Retry stays pressable after a press that could not start a load.
- The gallery's Retry board shows the conversation rows, the lines a run ends on in both looks of the text action, the machine cards and both forms of the load-failure notice.
