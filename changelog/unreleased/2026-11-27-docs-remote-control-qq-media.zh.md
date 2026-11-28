# 远程控制文档补充 QQ 的图片、文件与语音

- **Date:** 2026-11-27
- **Type:** process
- **Scope:** `docs`
- **PR:** [#1927](https://github.com/Prism-Shadow/penguin-harness/pull/1927)

[English](2026-11-27-docs-remote-control-qq-media.md)

远程控制页面不再说 QQ 只支持文本。

## 细节

- QQ 小节写明文本、图片和文件支持双向传递，语音以 QQ 的转写文字送达，引用的消息会作为引用块交给 Agent。
- 同时写明文件占用该消息的一条回复额度，且仅在没有文本等待最后一条回复时才能发送；没有剩余额度或被 QQ 拒收的文件，会在聊天里留下一行说明并记入异常记录。
- 共用的「接收媒体」与「发送文件」小节把 QQ 与其他渠道并列。
