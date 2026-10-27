# 服务端按浏览器所在的地址构造与校验源

- **Date:** 2026-10-26
- **Type:** fix
- **Scope:** `server`, `desktop`, `docs`
- **PR:** [#1336](https://github.com/Prism-Shadow/penguin-harness/pull/1336), [#1351](https://github.com/Prism-Shadow/penguin-harness/pull/1351)

[English](2026-10-26-oauth-callback-port.md)

在模型页连接 TokenDance，授权完成后浏览器被带到 `http://localhost/api/projects/<project>/model-oauth/callback?…`，地址里没有端口，跳转到不了 App，浏览器与桌面端都是如此。发起授权的请求走 Web App 的 API socket，而这条 socket 上的每个调用都以固定的 `http://localhost` 为地址。经 Penguin Remote 访问的桌面端（`https://u<N>.go.penguin.ooo`）上，跳转地址是明文 HTTP；浏览器的写请求能通过来源检查，只是因为 Penguin Remote 客户端把它们的 `Origin` 改写成了 `http://`。

现在服务端只推导一个**公共源**（public origin），即浏览器地址栏里的地址，凡是构造或比对源的地方都用它。代理受信任时（`PENGUIN_TRUST_PROXY=1`），协议取自 `X-Forwarded-Proto`，主机取自 `X-Forwarded-Host`，没有时取 `Host`，各只认单个值（见[受信任代理的加固](2026-10-26-trust-proxy-hardening.zh.md)）；否则就是连接本身的协议与 `Host`。

## 细节

- API socket 上的调用以建立 socket 时的公共源为地址，含端口，与 HTTP 请求一致。
- 模型厂商的授权跳回公共源，「跳转还是填写一次性授权码」也按它判断：以局域网地址的明文 HTTP 打开 Web App 时重新直接进入填码这一步；此前 socket 让它变回了跳转到 `localhost`。
- 写请求、API socket 与终端的握手、Workbench 处理器上的来源检查接受公共源的协议加请求的 `Host`。在 Penguin Remote 的一跳（目前是它的客户端）为旧版桌面端改写 `Origin` 期间，桌面应用的服务端也接受请求自身的来源，见[向后兼容](2026-10-26-backward-compatibility.zh.md)。
- `POST /api/builtin-browser/extension/pairings` 返回的 `origin` 改为公共源，不再照抄请求的 `Origin` 头。
- 公共源是 `https` 时，会话 Cookie 带 `Secure`，热更新的网络检查也视为 HTTPS。
- 桌面应用内嵌的服务端以 `PENGUIN_TRUST_PROXY=1` 运行。它只监听回环地址，经 Penguin Remote 访问时能看到浏览器的 `https://` 地址。
- 配置、安全与服务端 API 文档写明了公共源、代理须设置的转发头，以及桌面端为何信任它们。
