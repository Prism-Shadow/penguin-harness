# A remote conversation's history loads newest first, with progress

- **Date:** 2026-10-29
- **Type:** fix
- **Scope:** `web`, `ui`, `ui-gallery`
- **PR:** [#1393](https://github.com/Prism-Shadow/penguin-harness/pull/1393)

[中文版](2026-10-29-history-stream-web.zh.md)

A long conversation on a remote machine no longer failed with 「历史消息加载失败：网络错误」 on a slow link. The chat read its history over the `history` stream instead of one call with a 20-second deadline. The first read asked for the newest Tasks that fit 64 KiB of records, so the latest messages showed within seconds even at 10 KB/s. Older windows then followed until the conversation's newest 20 Q&A pairs were on screen, each one added above the transcript without moving the reading position. A prompt with images counted as one pair, as the server counts it. A dropped link was resumed by the socket from the last event, and no record arrived twice. A reconnect that had to read the history again kept the earlier windows on screen: when new Tasks had arrived meanwhile, the windows between were read behind the transcript and joined at the exact record where the old ones began. Leaving the conversation closed every read it had opened.

Conversations on this server changed too: their history came over the same stream, opened on the newest Tasks and filled up to 20 pairs, and carried the same folded values. A conversation that fit its first window looked as before, with no beginning-of-conversation marker; the marker showed only after the reader scrolled up past the pairs the conversation opened on.

While a conversation on a machine was still loading after one second, the skeleton gave way to a transfer row that named the machine and showed the amount received against the total, in one unit and at one width. The row waited for the machine list, so the machine's name never popped into a row already on screen. When the server was retrying the machine, the retry showed under the row with Retry now, in words that told a lost connection (reconnecting) from a connected machine that had stopped answering (asking again); the machine's own retry row showed while the machine was away. Once the newest messages were on screen, one muted line at the top of the transcript showed the rest of the conversation syncing to this server, and it went away when the sync finished. An older window that was still being fetched showed its own progress in the same place; the automatic fill-up to 20 pairs was one line from its first window to its last, and like the skeleton, the line said nothing during its first second.

A tool output, a long tool argument or a thinking block that the history carried folded showed its head and tail around an ellipsis; inside a call's arguments the ellipsis sat in the folded string itself. Opening the row fetched the whole value and showed it in place of the preview. A fetch that failed said why on the same line, with a retry. A pending approval always showed the whole call it asked about: the server's re-sent request replaced the folded copy from the history.

The Trace panel brought a machine's Trace file to this server with the same progress row before reading its analysis, instead of forwarding a minutes-long read. It asked for that one file only, and a file on this server answered at once.

The UI package gained `TransferProgress`: one sentence of plain text, the amount and a thin progress bar. The tool call card and the thinking block gained a `bodyNote` slot that is mounted only while the row is open. The gallery showed the transfer row in each place it appears, and its mocked API answered the history and trace-body streams.
