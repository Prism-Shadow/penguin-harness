# QQ 与微信扫码绑定共用一个 ScanFlow 接缝与一个路由注册器

- **Date:** 2026-11-26
- **Type:** refactor
- **Scope:** `messaging`, `server`

[English](2026-11-26-messaging-scan-flow.md)

两条扫码绑定流程不再各写一遍。每个渠道的扫码服务实现同一个 `ScanFlow` 接口，像连接器贡献到 `connectors` 那样经 `MessagingModule.scanFlows` 槽贡献出来，路由由同一个注册器注册。每条路径、请求、响应、错误码与落库的配置文档都与原来相同。

## 细节

- `scan-flow.ts` 声明 `ScanFlow`——`start`、`poll`、可选的 `submitVerifyCode`、`cancel`、`cancelSession`——以及 `poll` 的返回：一个状态词，`completed` 时附上要落库的凭据 `{ accountId, config }`。
- `scan-routes.ts` 注册 `/<渠道>/scan`、`/scan/poll`、`/scan/cancel`，只为需要配对码的流程注册 `/scan/verify`；它依托会话路由提供的宿主（owner 校验、先停用再扫码的规则、落库）。轮询完成时，账号 id 放在槽数据指定的键下——QQ 为 `appId`，微信为 `botId`——与绑定的掩码视图并列返回。
- `QQScanService` 与 `WeChatScanService` 实现 `ScanFlow`，完成的轮询返回要落库的凭据，不再返回 `bot` 对象。`QqScanFlow` 与 `WechatScanFlow` 负责贡献它们，`MessagingModule` 改为收集该槽，不再自己构造两个服务。
- `QQScan` 接口移出 `bridge.ts`，`MessagingHubModule` 不再导出它；除测试辅助代码外没有任何地方读取它。
- 新增一组测试，用 Telegram 与飞书上的玩具流程经 HTTP 驱动注册器——这两个渠道本身没有扫码。
