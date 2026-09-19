# 同一主机上的两个实例可同时保持登录；写请求必须来自本应用自己的页面

Date: 2026-09-19
Type: fix
Scope: server, cli
PR: https://github.com/Prism-Shadow/penguin-harness/pull/800

**登录一个实例不再把另一个实例登出。** Cookie 的作用域是主机、不区分端口，因此在同一主机上访问的两个实例——发行版与开发版，或手机上打开的两条隧道——共用 `penguin_session` 这一个 Cookie，每次登录都会覆盖对方的。现在浏览器拿到的 Cookie 名带上了它访问服务端所用的端口（`penguin_session_<port>`）；登出只清除本服务端自己的会话。非浏览器客户端——CLI、与所持有机器通信的服务端——各有自己的 Cookie 容器，仍使用原名，因此旧版 CLI 可以继续访问新版服务端。浏览器送来的原名 Cookie 依然被接受，升级不会把任何人登出；已登录的浏览器在重新登录之前仍共用那一个 Cookie。

**写请求必须来自本来源的页面。** `/api` 下凡带有 `Origin` 头的 `POST`、`PUT`、`PATCH`、`DELETE`，其来源不是本服务端自己（主机与端口都要一致）即以 `403 cross_origin_write` 拒绝——终端的 WebSocket 握手原本就是这条规则，现在两处共用。只靠 `SameSite` 不够：同一主机的另一个端口属于同站，任何其他本地程序提供的页面都可以借用登录会话。没有 `Origin` 的请求不是浏览器发出的，不受影响（CLI、脚本、热推送）。

**有请求体却没有 Content-Type 的写请求被拒绝（`415`）。** 原先的内容类型规则放行没有 Content-Type 的请求，前提是它没有请求体；而页面是可以发出这种请求的（`fetch` 配合无类型的 `Blob` 与 `mode: "no-cors"`），处理器又不问类型就把它当作 JSON 解析。
