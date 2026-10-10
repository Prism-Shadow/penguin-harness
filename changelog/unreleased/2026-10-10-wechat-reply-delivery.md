# WeChat replies no longer go missing after a restart or a long run

- **Date:** 2026-10-10
- **Type:** fix
- **Scope:** `server`, `web`, `docs`

[中文版](2026-10-10-wechat-reply-delivery.zh.md)

WeChat replies were lost with `wechat send failed: prepare failed`, most often after a server restart or partway through a long run. WeChat takes a bot message only when it carries the conversation token (`context_token`) from the user's recent message, and each token covers about 10 messages. The connector forgot these tokens on every restart, reconnect and settings save; it now keeps them and works within their limits.

## Details

- Conversation tokens are stored in the database, in the new table `messaging_conversations`, so restarts, reconnects and saving the delivery options keep them. They are deleted with the last binding that uses the bot.
- Replies follow a budget like QQ's: for each message from the user, the first 9 go out live and the rest are combined into the 10th.
- A text reply WeChat will not take yet is held instead of dropped, and sent right after the user's next WeChat message, under a short header. The binding panel says that replies are waiting and since when, in place of a send failure; the runtime status reports it as `heldReplySince`.
- **Send test message** answers with a clear "message the bot in WeChat first" (409 `wechat_needs_recent_message`) when WeChat will not take the message. It is never held.
- A single network blip on the long poll is retried at once instead of being recorded as a connection interruption.
- The binding editor's troubleshooting FAQ has a WeChat entry on the reply limits, and the Remote control and Server API docs describe the limits, held replies and the new 409.
