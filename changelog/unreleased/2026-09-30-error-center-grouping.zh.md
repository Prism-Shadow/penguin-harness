# 异常中心把同一天的重复记录合为一行并计数，能自行恢复的消息渠道失败记为预期内

- **Date:** 2026-09-30
- **Type:** fix
- **Scope:** `server`, `web`, `docs`
- **PR:** [#908](https://github.com/Prism-Shadow/penguin-harness/pull/908)

[English](2026-09-30-error-center-grouping.md)

成本中心的异常表把同一天里来源、错误码、分类和消息都相同的记录合为一行，并标出条数；消息渠道里能自行恢复的连接失败与发送失败改记为 `expected`，不再记为 `unexpected`。

## 细节

- **每天每种异常一行。** `GET /usage` 与 `GET /usage/errors` 新增可选参数 `utcOffsetMinutes`，即读者所在时区相对 UTC 向东的分钟数，Web App 按浏览器的时区传入；异常表按读者的自然日、来源、错误码、分类和消息折叠记录。每一行（`UsageErrorItem`）带上 `count`、最近一次的时间 `ts` 和首次的时间 `firstTs`，按最近一次倒序。分页按行计，两个响应都新增了行数 `rows`，而 `total`、未预期数量和最常见错误码仍按记录计。不传偏移时按服务器自己的日期。清空仍按记录删除，记录器的短窗去重与行数上限不变。
- **面板。** 代表多条记录的行在消息后以小号灰字标出「×N」，时间显示最近一次、悬停给出首次，分页按行计数（「共 25 行」）。
- **每个连接失败与发送失败都带判定。** 连接器接缝上的 `MessagingChannelError` 带有 `recovers`，由读懂这次失败的地方给出。Telegram、QQ 与微信的传输层把请求根本没有完成、HTTP 408、429 或 5xx 判为会恢复；微信另把 `-14` 会话超时和凭据通过之后的任何拒绝（如发送时的「prepare failed」）判为会恢复。QQ 网关在 4009 与 4900–4913 之外，又加上握手超时、心跳失联、平台要求的重连，以及传输层关闭 1001、1006 与 1011–1014。`TelegramApiError`、`QQApiError`、`WeChatApiError` 与 `MessagingConnectionClosedError` 都成为它的子类型。
- **分类。** `messagingErrorKind` 在 `messaging_connect_failed` 与 `messaging_send_failed` 两个捕获点上，判定会恢复的失败记为 `expected`，其余记为 `unexpected`，没有类型的失败也在其中。被拒的凭据、缺少权限、Telegram 的 webhook 或另一个轮询程序（409）、屏蔽了机器人的聊天以及 QQ 的回复额度仍为 `unexpected`。其他捕获点的规则不变；飞书的长连接只在 SDK 放弃重连后才上报，没有加判定。
- **一次故障一条记录。** Telegram 与微信的轮询循环沿用 QQ 网关的规则：会恢复的失败不占住这次故障唯一的记录名额，随后第一个不会恢复的失败同样会记录。
- **既有记录。** 表中已有的行保留写入时的分类。
- **文档。** 「成本中心」与「Server API」两个页面说明了折叠后的行、`utcOffsetMinutes` 与 `rows`，以及连接失败与发送失败如何分类。
