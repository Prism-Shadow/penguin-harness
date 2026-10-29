# The retry row reads like the rest of the conversation, and a history that fails to load is no longer red text

- **Date:** 2026-10-29
- **Type:** fix
- **Scope:** `ui`, `web`, `ui-gallery`

[中文版](2026-10-29-retry-row-style.zh.md)

The model request's retry row in a conversation ("Request failed after 6 attempts", the countdown before the next attempt) was the one line in the transcript drawn bare: a medium-weight sentence in the body ink at the column's edge, unlike every other note around it. It now wears the transcript's one-line note, so each theme draws it the way it draws its other notes: Primer a grey strip at the content's width, Frost a line of words, Console a transcript line. A conversation whose history could not be read no longer says so in red, colon-joined text.

## Details

- The shared retry row (`RetryStatus`) sets its sentence at the body weight in every place it appears (machine cards, the Machine dialog, conversations): in the body ink while an attempt is running or waiting, in the muted ink once it has stopped, and never in the danger ink. Only the mark is coloured. The spinner shares the other marks' size, so the sentence no longer shifts when an attempt settles.
- `RetryStatus` takes `frame="note"` for a row between a conversation's messages. The phase's mark stays visible in every theme, the cause stays behind the "?", and Retry, Retry now and Stop retrying stay link-style text.
- A new shared notice, `LoadFailed`, stands in for content that could not be loaded: a mark, a title, a muted line with the reason or what happens next, an optional status row, one button and a folded technical detail. When a conversation's history fails to load, the chat shows the danger cross, "Couldn't load the message history", the error on its own muted line, and Retry. A conversation on a machine that is out of reach uses the same notice with the machine's glyph, unchanged in content.
- When earlier messages fail to load at the top of a conversation, the chat shows the shared retry row ("Couldn't load earlier messages", the error behind the "?", Retry) instead of a red sentence that was itself the button.
- The gallery's Retry board shows the conversation rows in their note frame, the earlier-messages row, and both forms of the load-failure notice.
