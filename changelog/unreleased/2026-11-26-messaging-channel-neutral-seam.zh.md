# 消息接入的公共接缝不再点名 QQ，也不再手写渠道名单

- **Date:** 2026-11-26
- **Type:** refactor
- **Scope:** `messaging`, `server`
- **PR:** [#1918](https://github.com/Prism-Shadow/penguin-harness/pull/1918)

[English](2026-11-26-messaging-channel-neutral-seam.md)

消息接入库与 server 里各渠道共用的代码，原先耦合到某一个渠道、手写了一份渠道名单，或带着从未使用的 import。用户与 HTTP 客户端看到的一切不变：每条路径、请求、响应与错误文案都与原来逐字节相同。

## 细节

- `MessagingConnectionClosedError` 从 `qq-api.ts` 移到 `connector.ts`，与 `MessagingChannelError` 并列，`error-kind.ts` 分类一条被关闭的连接时不再引入某个渠道的文件。抛出它的仍是 QQ 网关，行为不变；server 的测试改从 `@prismshadow/penguin-library-messaging/connector` 引入它。
- `MessagingSlots.connectors` 的数据类型写作 `{ channel: MessagingChannel }`，不再手写第二份字面量联合。
- `enabled-channel.ts` 导出 `MESSAGING_CHANNELS`（按其表中顺序排列的渠道 id），account-holders 路由对未知渠道返回的 400 由它生成渠道名单，不再写死字符串。
- server 的 `app.ts` 删去了十九个从未使用的消息接入 import——桥、每个渠道的连接器与 transport，以及两个扫码服务；装配它们的本来就是 `platform.ts` 与 `runtime/messaging/module.ts`。
