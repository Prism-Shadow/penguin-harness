# 渠道收不下的出站文件改记入成本中心，不再发进聊天

- **Date:** 2026-09-17
- **Type:** fix
- **Scope:** `server`, `docs`
- **PR:** [#776](https://github.com/Prism-Shadow/penguin-harness/pull/776)

[English](2026-09-17-messaging-outbound-file-errors.md)

回复中提及的文件没能送达消息聊天（飞书、Telegram、QQ 或微信）时，聊天里不再在回复之后出现一条双语提示——
例如 QQ 对每个它收不下的文件都会发出的「文件“xx.md”未能发送到会话」。这些失败改为在该 Session 所属的
Project 下记为错误记录，每条回复按原因各记一条，显示在成本中心的异常表中。入站图片与文件下载失败的提示、
以及审批提醒，仍照常发到聊天里。

## 细节

- 移除了四种出站提示：上传失败、机器人应用缺少上传权限、文件超过单张图片 10MB 或单个文件 30MB 的上限、
  超出每条回复随附 5 个文件的部分。
- 每条回复按原因各记一条错误记录，写明其涵盖的每个文件、渠道与原因——各文件原因不同时每个文件占一行：
  被拒绝的上传记 `messaging_file_send_failed`，渠道根本无法承载的上传、缺少权限（所需权限与控制台授权链接
  只列一次，取代渠道对每个文件给出的原因）与其余拒绝各记一条；超过上限的文件记新增的
  `messaging_file_too_large`，逐个写明其上限；超出数量的部分记新增的 `messaging_files_skipped`。单个文件的
  记录写作 `"<file>" was not sent to the <channel> chat: <reason>`。每条消息（包括超出数量的那条）都控制在
  记录器 500 字符的上限之内，超出时先截短文件列表，截去的部分以 `…` 标明。
- QQ 拒绝外发文件时的原因不再点名文件，于是同一条回复里被拒的文件共用一行原因：`QQ cannot receive files:
  sending a file to QQ requires a publicly reachable URL for it, which this server has no way to provide`。
- 类型：超过上限的文件、超出数量的文件、以及渠道根本无法承载的上传（QQ 上的任何文件）记为 `expected`；
  缺少上传权限与其余被拒的上传记为 `unexpected`，因为聊天里已不再有人拿到解决办法。已写入的记录保持原有类型。
- 在 QQ 上，被拒的文件不再为一条提示占用一次被动回复额度。
- 服务端 API 参考的中英两份都写明了这些情况记在哪里。
