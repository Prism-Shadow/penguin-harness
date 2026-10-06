# Loading an earlier page of a conversation leaves the reader where they were

- **Date:** 2026-10-06
- **Type:** fix
- **Scope:** `web`

[中文版](2026-10-06-history-prepend-anchor.zh.md)

Scrolling to the top of a conversation fetches the earlier page and places it above what is shown. The reader used to be pushed down by that whole page, or thrown to the end of the conversation; now the message they were reading stays where it was.

- The rendered list and the prepend correction change in the same render: the list's memo is keyed on the prepended content itself, not only on a throttled version number.
- The correction is measured, not assumed: the oldest visible prompt's position is recorded at every scroll and render, and after a prepend the view is moved by however far that prompt actually moved. The browser's own scroll anchoring compensates away from the top and not at offset 0, so a fixed height-delta correction applied twice or not at all.
- The loading row at the top keeps its height whenever history lies above, so its appearing and disappearing no longer shift the transcript.

Paging itself, the server and the stream controller are unchanged.
