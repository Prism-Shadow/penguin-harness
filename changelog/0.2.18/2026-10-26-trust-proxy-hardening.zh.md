# 受信任代理之后的来源检查只读单个转发协议与原始 Host

- **Date:** 2026-10-26
- **Type:** fix
- **Scope:** `server`, `desktop`, `docs`
- **PR:** [#1351](https://github.com/Prism-Shadow/penguin-harness/pull/1351)

[English](2026-10-26-trust-proxy-hardening.md)

受信任代理时（`PENGUIN_TRUST_PROXY=1`），写请求、API socket 与终端握手、Workbench 处理器上的来源检查收窄回[公共源](2026-10-26-oauth-callback-port.zh.md)之前接受的范围，并且开始读取浏览器的 `Sec-Fetch-Site`。

## 细节

- 只有桌面应用的服务端仍接受请求自身的来源（连接的协议加 `Host`），期限是 Penguin Remote 客户端为旧版桌面端改写 `Origin` 的这段时间，见[向后兼容](2026-10-26-backward-compatibility.zh.md)。其他位于终结 TLS 的代理之后的服务端，在写请求和 API socket 握手上都拒绝 `Origin: http://<公网主机名>`。
- `X-Forwarded-Proto` 与 `X-Forwarded-Host` 只认单个值：`http` 或 `https`，以及一个裸 `host[:port]`。受信任代理时，转发头是列表（`https, http`）或格式不对的写请求与握手，以 `403` `cross_origin_write` 拒绝，与公共源之前一致；热更新的网络检查也不把这样的协议视为 HTTPS。交还给浏览器的地址遇到这样的头，改用请求自身的协议或 `Host`。
- 来源检查拿 `Origin` 与转发的协议加请求自身的 `Host` 比对。`X-Forwarded-Host` 只影响交还给浏览器的地址：模型厂商授权后的跳转地址、Chrome 扩展配对时连接的地址，以及 API socket 上调用的源。
- 带有 `Sec-Fetch-Site` 且值不是 `same-origin` 的写请求、API socket 握手与终端握手一律拒绝。Agent API 带密钥的写请求与浏览器扩展的配对请求仍不受此约束。
- 配置、安全与服务端 API 文档写明了对代理的要求：保留 `Host`，用单个值覆盖 `X-Forwarded-Proto`，覆盖或删掉 `X-Forwarded-Host`，并为主机名启用 HSTS；也写明了过渡规则只适用于桌面端，以及哪些页面能连上桌面端的回环端口、又是什么把它们挡在外面。
