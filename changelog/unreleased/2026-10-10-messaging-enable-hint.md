# A greyed-out remote-control switch says what to do first

- **Date:** 2026-10-10
- **Type:** feature
- **Scope:** `web`, `docs`

[中文版](2026-10-10-messaging-enable-hint.zh.md)

In a conversation's remote-control editor, the **Enable connection** switch stays greyed out while a step is missing, but a click on it is no longer ignored. The click sends nothing to the server. It shows the hint line's reason as a toast, briefly highlights that line, and moves the focus to where the step is done: the QR code on WeChat and QQ, the first empty credential field on Feishu and Telegram, or the **Save** button when the form has unsaved changes. When another channel holds the connection, the reason names that channel and the focus stays where it is.

The missing-credential reason is worded per channel: scan on WeChat, scan or enter and save the App ID and App Secret on QQ, enter and save the App ID and App Secret on Feishu, and enter and save the Bot Token on Telegram. The Remote control documentation describes the click.
