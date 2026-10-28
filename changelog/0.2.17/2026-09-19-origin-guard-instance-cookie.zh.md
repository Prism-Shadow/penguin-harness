# 同一主机上的两个实例可同时保持登录；写请求必须来自本应用自己的页面

- **Date:** 2026-09-19
- **Type:** fix
- **Scope:** `server`, `cli`
- **PR:** [#1268](https://github.com/Prism-Shadow/penguin-harness/pull/1268)
- **Breaking:** yes — 在终止 TLS 的反向代理之后，除非服务端以 `PENGUIN_TRUST_PROXY=1` 运行、且代理保留外部 `Host`，否则 Web App 的每个写请求都以 `403 cross_origin_write` 被拒绝

[English](2026-09-19-origin-guard-instance-cookie.md)

**登录一个实例不再把另一个实例登出。** Cookie 的作用域是主机、不区分端口，因此在同一主机上访问的两个实例——发行版与开发版，或手机上打开的两条隧道——共用 `penguin_session` 这一个 Cookie，每次登录都会覆盖对方的。现在浏览器拿到的 Cookie 名带上了它访问服务端所用的端口（`penguin_session_<port>`）；登出只清除本服务端自己的会话。非浏览器客户端——CLI、与所持有机器通信的服务端——各有自己的 Cookie 容器，仍使用原名，因此旧版 CLI 可以继续访问新版服务端。浏览器送来的原名 Cookie 依然被接受，升级不会把任何人登出；已登录的浏览器在重新登录之前仍共用那一个 Cookie。

**写请求必须来自本来源的页面。** `/api` 下凡带有 `Origin` 头的 `POST`、`PUT`、`PATCH`、`DELETE`，其来源不是本服务端自己（协议、主机与端口都要一致）即以 `403 cross_origin_write` 拒绝——终端的 WebSocket 握手原本就是这条规则，现在两处共用。只靠 `SameSite` 不够：同一主机的另一个端口属于同站，任何其他本地程序提供的页面都可以借用登录会话。来源比较前先按 URL 规则规范化：域名的字母大小写、以及协议默认端口（`http://example.com` 与 `http://example.com:80`）都不算差异。经过终止 TLS 的代理时，仅在启用 `trustProxy` 后采信转发协议；代理须保留外部主机并将 `X-Forwarded-Proto` 覆盖为 `http` 或 `https`。没有 `Origin` 的请求不是浏览器发出的，不受影响（CLI、脚本、热推送）。唯一的例外是 Agent API：`/api/amsp/v1` 应答任何来源的预检，并接待以 `Bearer` 出示 Agent 密钥的调用方，因此那里的带密钥写请求交给该组自己的闸门校验——它从不接受 Cookie——而带 Cookie 或没有凭证的写请求仍按上面的规则拒绝。

**有请求体却没有 Content-Type 的写请求被拒绝（`415`）。** 原先的内容类型规则放行没有 Content-Type 的请求，前提是它没有请求体；而页面是可以发出这种请求的（`fetch` 配合无类型的 `Blob` 与 `mode: "no-cors"`），处理器又不问类型就把它当作 JSON 解析。工作台自己的处理器是例外：它接受任意请求体——上传、或它所转发的程序的表单——守它的是浏览器自己对请求来源的说明（`Sec-Fetch-Site`，以及 `Origin` 对请求 URL 的来源），且对每一种方法都生效，而不只是写请求。

## 兼容性

- 部署在终止 TLS 的反向代理之后时，请以 `PENGUIN_TRUST_PROXY=1` 启动服务端，并让代理保留外部的 `Host` 头、把 `X-Forwarded-Proto` 覆盖为 `https`。否则页面的 `https://` 来源与服务端收到的明文 HTTP 请求对不上，Web App 的每个写请求都会以 `403 cross_origin_write` 被拒绝。改写 `Host` 的代理同样会被拒绝。
- 来源规则不涉及不带 `Origin` 头的请求（CLI、脚本），也不涉及 Agent API 带密钥的调用。
- 带请求体却没有 `Content-Type` 的写请求以 `415 unsupported_media_type` 被拒绝，请发送 `Content-Type: application/json`。
