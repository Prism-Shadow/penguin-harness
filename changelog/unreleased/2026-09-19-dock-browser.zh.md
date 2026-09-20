# 停靠栏里的浏览器标签：页面在专属主机上运行，并获得 App 主题

- **Date:** 2026-09-19
- **Type:** feat
- **Scope:** `server`, `web`, `docs`
- **PR:** [#806](https://github.com/Prism-Shadow/penguin-harness/pull/806)

[English](2026-09-19-dock-browser.md)

停靠栏新增浏览器标签。其中的 `localhost:3000` 指本对话 Workspace 所在机器的 3000 端口；其他地址是公网地址。每个页面都运行在自己的主机上，远离 App 的 Cookie。

## 地址

- **回环名指 Workspace 所在的机器。** `localhost`、`127.0.0.1`、`[::1]` 与 `*.localhost` 到达 Workspace 所在机器的回环：经已持有的连接（自身从不拉起 ssh），Workspace 在本服务端时直连——走 `http`，那边的服务说 TLS 时走 `https`（不校验其证书：这一跳是回环或 ssh 通道）。永不指向本服务端自己的端口。它不需要、也不会创建端口转发。
- **其余主机名是公网地址**，由本服务端经常规出站通道请求，因此遵循管理员代理设置。
- 只接受 `http` 与 `https`；带用户名或密码的地址被拒绝；裸地址按 `http://` 补全。

## 隔离

- **每个站点获得 `<label>.localhost`。** 站点即 `(用户, 机器, 上游 Origin)`。浏览器无需 DNS 就把 `*.localhost` 解析到回环，而 App 在 `localhost` 上的 host-only 会话 Cookie 不会发往那里。根绝对路径、Cookie 与 storage 原样可用，站点之间互不可见。
- **label 为 128 位随机数**，存于 `web.db`（`browser_sites`，migration 14 `browser-sites`，swap-safe），因此重启或热推送之后站点仍在原主机上，Cookie 与 storage 得以保留。每个用户保留最近使用的 200 个。
- **浏览器主机上没有 App。** `HttpModule` 新增 `hosts` slot：Host 匹配的请求先于请求体上限、JSON-only 规则、Cookie 门与一切路由组分发给绑定的 app，且从不落回。未知 label 答 `404`。
- **站点只能由 App 签发**：`POST /api/browser/sites`，位于浏览器页面永远拿不到的会话 Cookie 之后。机器的端口需要管理员；本服务端的端口与公网对任一登录用户开放。
- label 是该主机唯一的凭据，因此所有代理响应都带 `Referrer-Policy: no-referrer`。iframe 沙箱不含 `allow-top-navigation`。
- 浏览器需要 App 经 `localhost` 打开（桌面端、本机，或隧道到本机）；否则签发端点答 `409` `browser_unavailable`，标签内说明原因。

## 出站防护

- 对公网目标的每次请求，主机名解析出的全部地址都必须是公网地址。回环、私网、CGNAT、链路本地（含云元数据）、组播与保留段、IPv6 ULA 与链路本地、IPv4 映射与 NAT64 形态一律拒绝，无法识别的形态同样拒绝。
- 直连时该校验就是 socket 自己的 `lookup`，从而堵住 DNS rebinding。经前置代理出站时由代理自行解析，校验并行进行。
- 服务端从不跟随重定向。指向站点自身的 `Location` 改写到浏览器主机，其余交给浏览器。

## 代理与主题

- 向上游请求时使用它自己的 `Host`，`Origin` 与 `Referer` 映射回其 Origin。响应中删除 `X-Frame-Options`、CSP 的 `frame-ancestors` 与 HSTS。
- **站点的 Cookie 在标签内可用。** iframe 按设计与 App 跨站，浏览器在这种位置会丢弃未声明 `SameSite=None; Secure` 的 Cookie——缺省的 Lax 无论来自响应头还是脚本都被拒绝。因此每条 `Set-Cookie` 去掉 `Domain=` 并改写为 `SameSite=None; Secure; Partitioned`，引导脚本对 `document.cookie` 做同样处理。`Secure` 在明文 http 的 `*.localhost` 上被接受；`Partitioned` 让 Cookie 在屏蔽第三方 Cookie 的环境下也能保留。
- **页面写死的完整地址会回到它的主机。** 以为自己在 `http://localhost:3000` 上并这样写的页面——`fetch("http://localhost:3000/api")`、`new WebSocket("ws://localhost:3000")`——本会连到查看者自己的 3000 端口。引导脚本在 `fetch`、`XMLHttpRequest`、`WebSocket` 与 `EventSource` 中把这类地址带回浏览器主机。
- 不超过 8MB 的 HTML 在 `<head>` 最前注入引导脚本，页面 CSP 带 nonce 时沿用其 nonce。
- **主题是提供，不是强加。** 引导脚本把 `:root { color-scheme; --penguin-* }` 放在最前的 `<style>` 里，因此页面自己的声明总是胜出。变量为 App 已解析的 token 加 `--penguin-` 前缀——按当前明暗解析好的角色色（`--penguin-bg`、`--penguin-surface`、`--penguin-fg`、`--penguin-muted`、`--penguin-border`、`--penguin-hover`）、accent 对、字体栈与灰阶——因为未加前缀的名字同时也是 Tailwind 的。它们在加载完成与每次外观变化时发给 iframe，且只发给该标签的主机。
- 页面回报自己的地址与标题，因此地址栏跟随页内链接，标签取页面标题。离开本站点的链接交回标签，由它作为另一个站点打开。

## 页面

- 入口与终端的入口并列：停靠栏选单、「+」菜单、浮动球扇面，另有端口面板行上的「在浏览器标签中打开」，缺省落在右侧停靠栏。
- 顶部一行为后退、前进、重新加载与地址栏；Workspace 在本服务端时另有「在系统浏览器中打开」。标签所示地址随停靠栏布局一并保存，刷新后回到原页面。

## 不代理

- WebSocket upgrade，因此 dev server 的热重载通道连不上。握手属于 runtime。
- 被浏览站点自己的 `/api/*` 下的非 JSON 写请求：runtime shell 先于平台对该前缀执行 JSON-only 与请求体上限。
