# QQ 机器人双向支持图片、文件与语音转写

- **Date:** 2026-11-26
- **Type:** feature
- **Scope:** `messaging`
- **PR:** [#1908](https://github.com/Prism-Shadow/penguin-harness/pull/1908)

[English](2026-11-26-qq-rich-media.md)

QQ 渠道不再拒绝文件：回复现在可以发出 Agent 写出的图片和文件，用户发来的图片、文件与语音消息也会送达 Agent。

## 细节

- 外发文件先经富媒体上传接口注册（小文件用 `file_data`；较大的走 `upload_prepare`、分片 PUT、`upload_part_finish` 与合并），再以 `msg_type: 7` 的被动回复发出，不需要公网地址。
- 一个文件占用一个被动回复槽位，且仅在没有文本为最后一个槽位而被扣下时才可使用。没有槽位、或被 QQ 拒绝的文件，会在聊天里留一行说明，并仍记一条异常。QQ 不认的图片格式会改作文件重发。
- 入站的 `attachments` 成为 Agent 收到的图片与文件；语音以 QQ 自带的转写文本送达；被引用消息的文本作为引用块放在回复之前。
