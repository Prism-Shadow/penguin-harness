# PRFC-0011 单一套接字

[English](PRFC-0011-single-socket.md)

> **来源**：设计仓 [penguin-harness-design](https://github.com/Prism-Shadow/penguin-harness-design) 的 `rfcs/PRFC-0011-single-socket.md`——草案，见设计 PR [#126](https://github.com/Prism-Shadow/penguin-harness-design/pull/126)（draft）。
> **修订**：v1.0.0（迁入主仓，取草案当前版本）；本面的约定见 [README.zh.md](README.zh.md)，逐版本改动记在文末 `## Changes`。

- Feature Name: `single_socket`
- Start Date: 2026-09-07
- PRFC PR: [Prism-Shadow/penguin-harness-design#126](https://github.com/Prism-Shadow/penguin-harness-design/pull/126)
- Implementation PR: [Prism-Shadow/penguin-harness#642](https://github.com/Prism-Shadow/penguin-harness/pull/642)（已关闭，由 [#912](https://github.com/Prism-Shadow/penguin-harness/pull/912) 接替）
- 相关: PRFC-0013（HMR v1）cookie 门按组挂载的修订（[route-group-gate](https://github.com/Prism-Shadow/penguin-harness-design/pull/195)）、[per-Session credential 设计](https://github.com/Prism-Shadow/penguin-harness-design/pull/235)（`requireHuman` 的结构性后继）；本篇的鉴权修订原拟另立 PRFC-0021（[#332](https://github.com/Prism-Shadow/penguin-harness-design/pull/332)，已关闭），现收编进本篇，不留作另一份规范

## Summary
[summary]: #summary

服务端已有的 HTTP 端点就是 **API server**：一组与传输无关的操作，HTTP 是它的一种传输，一条 WebSocket 是另一种。一个浏览器标签页与它的服务端之间**只有一条 WebSocket**（在终端流的 upgrade 路径上、以登录用户命名的保留 id 打开，见「传输与握手」），其上跑的不是一套新协议，而是**等价的异步 API 调用**：每一帧是一次对既有端点的调用（方法、路径、查询、正文、头），得到同一个端点的响应。**鉴权也走同一扇门**：套接字上的每次调用携带握手时认证过的那条会话凭证——只在服务端持有、永不进帧——经与 HTTP 相同的 cookie 门进入路由，授权、`sessionVia` 与错误形状逐调用与 HTTP 一致；唯一的差别是套接字的应答不携带 Set-Cookie（当前实现本就不在升级与帧应答上写它，本设计也不依赖在那里写它），因此套接字**从不续期**会话，吊销与过期对它逐调用生效、对空闲连接由心跳在一个周期内收回。返回事件流的端点（`/api/events`、`/api/sessions/:id/stream`）在这条传输上就是一次不结束的调用，帧逐条送达，取消即退订。因此本服务端的用户级事件、机器的用户级事件、任意数量的 Session 流，都是同一条套接字上并发的调用；`Last-Event-ID` 续传、有界缓冲、`resync_required` 原样沿用。HTTP 端点一个不删：CLI 继续用它们，浏览器在套接字未建立时也用它们。机器的调用由服务端在自己持有的 ssh 会话里以同样的方式转发——对每台机器也只有一条套接字。终端流保持独立的 WebSocket，**不**并入（理由见 Rationale）。

## Motivation
[motivation]: #motivation

**现象。** 桌面端与手机上都出现过「一个转发到机器的请求卡住，随后所有请求都卡住」。查下来不在服务端：Web App 对本服务端开一条 `GET /api/events`，对每台已连接机器再各开一条 `/server/<id>/api/events`（经同源代理），每个打开的会话页另开一条 `/api/sessions/:id/stream`——每条都是一个永不结束的 HTTP 响应。服务端只说 HTTP/1.1（回环上没有 TLS，也就没有 HTTP/2），而浏览器对同一 host 只并发六条 HTTP/1.1 连接；两三台机器加一个会话页就把配额占满，侧栏自己的列表请求从此排在那些长连接后面，在 DevTools 里表现为 Stalled。转发到机器的那条一旦在远端半死（ssh channel 不通、TCP 仍在），`EventSource` 收不到错误，那个槽位就永远回不来。

**结构上的原因。** 长连接的数量随「机器数 + 打开的会话页数」线性增长，而配额是常数。任何以「每样东西一条连接」为形态的方案都会撞上这个常数，换传输只是把它推远（WebSocket 的配额约为两百多条）。要让数量不随对象增长，连接就得是**一条**，对象是它上面的订阅。

**顺带解决的。** 机器的事件由浏览器逐台去取，意味着每台机器一条穿过 ssh 的 HTTP 长响应、一次 SOCKS 拨号，而 ssh 会话本来就握在服务端手里；由服务端订阅再并入，浏览器那一半从 `1 + N` 条降到 1 条，远端那一半从「每个标签页 N 条」降到「每台机器 1 条」。半死的连接由套接字协议级的 ping/pong 判死，而不是靠一行谁也收不到的 SSE 注释。

**场景。**

1. 手机打开 Web App，Project 下连着三台机器。此前：四条 SSE 长连接立刻占掉六条配额中的四条，侧栏按 Workspace 分组的十几个列表请求两条两条地排队。此后：一条套接字，列表请求全部并发。
2. 用户在会话页之间切换。此前：关一条 Session SSE、开一条。此后：同一条套接字上取消一个订阅、加一个订阅，没有握手。
3. 一台机器的 ssh 会话掉线又重连。此前：浏览器那条 `/server/<id>/api/events` 挂死或断开，靠 `EventSource` 的自动重连撞运气。此后：服务端在该机器的通道上下发「未连接」，浏览器把该机器标为离线；ssh 重连后服务端带着上次的事件 id 重新订阅，缺口从机器的缓冲里补回，浏览器无感。

## Guide-level explanation
[guide-level-explanation]: #guide-level-explanation

**先把一个概念摆正。** 今天的 `packages/server` 是一个 API server，只是它只有一种传输：HTTP。每个端点是一个操作——`GET /api/projects` 是「列 Project」，`POST /api/sessions/:id/tasks` 是「发一个 Task」，`GET /api/sessions/:id/stream` 是「订阅这个 Session 的流」。HTTP 把操作编成请求 / 响应，SSE 把「流」编成一个不结束的响应。本提案加**第二种传输**：一条 WebSocket，上面每一帧编码同一个操作。操作本身、它的授权、它的响应形状，一处定义、两种传输，谁也不比谁多一个功能；唯一的例外是会话续期：只有 HTTP 的应答续期（续期必随同一应答 Set-Cookie），套接字的应答从不续期——不变式见「入口、身份与平台」。

**给前端作者。** API 客户端还是 `apiFetch(path, options)`，路径还是那些路径。变化只有传输：套接字在时经套接字，不在时经 HTTP——调用方看不出区别。事件流同理：`openSessionStream(sessionId)` 与 `openUserEvents(machineId)` 签名不变，内部从 `EventSource` 变成套接字上一次不结束的调用。帧长这样：

```jsonc
// 客户端 → 服务端：一次调用
{ "id": 7, "call": { "method": "GET", "path": "/api/projects" } }
{ "id": 8, "call": { "method": "POST", "path": "/api/sessions/session-…/tasks", "body": { /* … */ } } }
{ "id": 9, "call": { "method": "GET", "path": "/api/sessions/session-…/stream", "headers": { "last-event-id": "41" } } }
{ "id": 10, "call": { "method": "GET", "path": "/server/m-…/api/events" } }     // 机器上的操作，路径与同源代理相同
{ "id": 9, "cancel": true }                                                     // 结束一次流式调用 = 退订

// 服务端 → 客户端
{ "id": 7, "status": 200, "body": { "projects": [ /* … */ ] } }                  // 一次性响应，一帧
{ "id": 9, "status": 200, "stream": true }                                       // 流式响应开始
{ "id": 9, "event": "message", "eventId": "42", "data": { /* OmniMessage */ } } // 之后每条事件一帧
{ "id": 9, "event": "server_event", "eventId": "43", "data": { "type": "task_state", /* … */ } }
{ "id": 9, "end": true }                                                         // 流结束（取消、服务端关闭、或背压丢弃，reason 说明）
{ "id": 10, "status": 503, "body": { "error": { "code": "not_connected", /* … */ } } } // 机器未连接：与 HTTP 代理同一答复
```

断线时客户端自己重连（退避）；重连后把每个仍在进行的流式调用重新发出，`last-event-id` 带各自最后收到的 `eventId`——与今天每条 SSE 各自重连是同一件事，集中到一处。一次性调用在断线时以错误结束，由调用方按原有的错误路径处理（多数 UI 已经会重试或提示）。服务端的鉴权收紧不需要前端再配合：`/api/me` 的应答说出页面此刻是谁（`identityIs`）、签到与签出翻转身份（`identityChanged`）、本服务器上的 401 在**两种传输上**都触发全局登出（`api/client.ts` 的判定不分传输）——被吊销或过期的标签页由这些既有联动带回登录页；`sessionKindPath` 与 `httpOnly` 的固定集合照旧。

**给服务端作者。** 端点不动、处理器不动、授权不动；运行时的改动收敛为两处。运行时只有一个 upgrade 入口，即终端流：`GET /api/terminals/<id>/stream`——验 Cookie，向平台的终端管理器要 `<id>`，核对它的 owner 是登录用户，把 socket 交给平台的 `attachStream`。这条链里除握手外全是平台代码，机器上的终端已经以 `<tid>@<machine>@<user>` 这种 id 走它（管理器的 `beyond` 钩子）。API 套接字是 `beyond` 认得的又一种 id：`api-socket@<userId>`，答以一个 owner 为该用户的引用；运行时照常核对 owner，于是「这条 socket 是谁的」由运行时证明。运行时的两处改动：其一，握手的认证换成**不续期**的校验（`Auth.validate`——`authenticateWithMeta` 查明的一切，减去续期），握手不再悄悄续行；其二，owner 核对后把**握手认证的那枚会话 token** 交给平台（`attachStream` 增加可选第五参 `credential`；终端流照旧不交，只有保留 id 的 api-socket 交）。之后每收到一帧 `call`，平台把它组装成 `Request`，在帧头白名单过滤**之后**盖上那枚凭证（`cookie` 头），经**与 HTTP 同一个 cookie 门**进入自己的路由（`Http.fetch(request, { renew: false })`：同一批路由组、同一个门逻辑，只是不续期、不写 Set-Cookie）——用户是谁永远由门从凭证读出，`Http.fetchAs` 与按用户缓存的路由树不复存在。把 `Response` 编成帧送回。一次性响应编成一帧；`text/event-stream` 响应逐事件编帧，注释行（SSE 心跳）丢弃，套接字有自己的 ping；平台拒绝的路径（`/api/auth`、`/api/hmr`，加上 `sessionKindPath` 的那批）答 421，客户端改经 HTTP。也就是说，一次推送就把套接字送到每台已安装的壳上；握手、Origin 检查、owner 核对仍是运行时已有的那份，新加的只有「把已认证的凭证交下去」与「握手不续期」两处。

**给机器那一层。** 路径以 `/server/<machineId>/` 开头的调用，与今天的同源代理走同一个转发层，只是转发层对每台机器维护**一条**到它的套接字（拨机器上 `api-socket@admin` 的终端流路径，经该机器的 ssh 会话拨出、以铸造的 1 小时 `cli` 会话认证——机器那端的运行时核对 owner 后，同样把会话 token 交给机器的平台，机器的门逐调用验证；`cli` 会话按既有语义读作 `password`，权限与从前一致，只是如今由真凭证挣得、并受铸币 1 小时上限约束），流式调用一律经它转发；机器回来的帧原样转给发起调用的浏览器套接字。机器未连接时答复与 HTTP 代理相同（`not_connected`）；ssh 会话掉线，该机器上所有进行中的流以 `end` 结束并带原因，浏览器按重连流程带 `last-event-id` 重发，缺口从机器的缓冲补回。机器那端的 `web_updated` 仍由前端忽略（那是那台机器的 web，不是这个窗口的）——转发层是传输，不认识事件。

**给使用者。** 没有新的东西可看。变化是：机器多了、会话页开多了，页面不再变慢；机器掉线时侧栏里它那一组立刻变灰，而不是停在旧状态直到某次刷新；会话被吊销（改密码、到处签退）或到期时，页面在下一次调用或一个心跳周期内回到登录页，不再停在那里照常工作。

## Reference-level explanation
[reference-level-explanation]: #reference-level-explanation

### 两种传输，一个 API

- 操作的定义就是今天的路由：方法 + 路径 + 查询 + 正文 → 状态 + 正文，或 → 事件流。本提案不新增操作，也不删除任何 HTTP 端点。
- **HTTP 传输**：现状，原样保留。CLI 只用它；浏览器在套接字未建立、正在重连、或被部署环境（不透传 Upgrade 的反向代理）拦住时用它。
- **WebSocket 传输**：在运行时既有的终端流 upgrade 入口上打开——`GET /api/terminals/api-socket@<userId>/stream`，`Upgrade: websocket`（`@prismshadow/penguin-server/api` 的 `apiSocketPath(userId)` 负责拼写）。握手就是终端流的握手：会话 Cookie、Origin 检查（WebSocket 握手不受 CORS 约束，没有它，用户访问的任何页面都能以其 Cookie 打开一条套接字）、以及 id 的 owner 必须是登录用户本人——admin 的 Cookie 打不开 `api-socket@alice`；握手的认证用不续期的 `Auth.validate`（见「入口、身份与平台」）。服务端到机器那一跳用铸造的 1 小时 `cli` 会话拨 `api-socket@admin`。此后套接字上的每次调用都携带握手认证的那条会话凭证、经同一个 cookie 门进入平台的路由；帧里不带、也不接受任何凭据。
- 一个标签页至多一条套接字；其上并发任意数量的调用，每个调用由客户端分配的 `id` 标识，`id` 在套接字生命周期内不复用。

### 帧

- 一律文本帧、一帧一条 JSON。二进制帧本阶段不用，留给终端（见 Future possibilities）。
- 客户端 → 服务端：`{ id, call: { method, path, headers?, body? } }` 发起调用；`{ id, cancel: true }` 结束一次进行中的流式调用。`path` 含查询串；`headers` 只接受一个白名单（`last-event-id`、`accept`、`content-type`）——凭据来自握手，帧里不带、带了也忽略；`body` 是 JSON 值，多部分正文（附件上传）不经此传输，走 HTTP。
- 服务端 → 客户端：一次性响应 `{ id, status, headers?, body }`（正文按响应 `content-type` 编码：JSON 原样，文本作字符串；二进制响应——文件下载——不经此传输，调用方收到 `415` 并回退 HTTP）；流式响应先 `{ id, status, stream: true }`，之后每条事件 `{ id, event, eventId, data }`（`event` 与 `data` 即 SSE 的 `event:` / `data:`，`eventId` 即 `id:`），最后 `{ id, end: true, reason? }`。SSE 注释行不转发。
- 服务端在一条套接字上的处理是并发的：调用之间不排队，流式调用不阻塞一次性调用。

### 入口、身份与平台

- 握手是运行时**已有**的终端流入口（`terminal/ws.ts`：Upgrade、Origin 检查、会话 Cookie、向平台要 id、核对 owner、交出 socket）。本提案对运行时的改动收敛为两处，都在这条链上：**其一**，握手的认证从会续期的 `authenticateWithMeta` 换成新的 `Auth.validate(token)`——`authenticateWithMeta` 查明的一切（行在、未过期、用户在、`via` 的归一读数：`remote`→`token`、`cli`→`password`、`desktop`/`setup` 原样）**减去续期**——握手从「开一条连接」变成与 SSE 心跳同级的「验一次、不续期」；**其二**，owner 核对后把**握手认证的那枚会话 token** 原样交给平台：`PlatformApi.attachStream` 增加可选第五参 `credential?: string`（终端流照旧不交，只有保留 id 的 api-socket 交）。`PlatformIface` 版本随签名递增；参数是纯增量——老平台忽略它、新运行时多传一个实参，JS 层两面都成立。凭证只在服务端持有，永不进帧。
- 平台侧的三处：终端管理器的 `beyond` 钩子认出保留 id `api-socket@<userId>`（`socket/ref.ts`），答以 owner 为该用户的引用；`attachStream` 认出引用，为它跑套接字协议（`socket/serve.ts`）——外壳的 api-socket 分支 **fail closed**：交接里没有凭证（旧运行时）即关闭套接字，不服务任何帧；`serveApiSocket` 在帧头白名单过滤**之后**把凭证盖上每个 `Request` 的 Cookie 头（`headers["cookie"] = SESSION_COOKIE + "=" + credential`——帧里即使塞了 `cookie` 头也会先被白名单丢弃，盖的是服务端自己那份），其余归一照旧（URL 取规范 App 主机 + `path`、方法、JSON 正文、白名单头）。没有新的凭据、密钥或认证算法：能拿到这条 socket 的前提就是运行时已经放行了握手，交下去的是握手已认证的那枚既有 token。
- 每一帧 `call` 被组装成 `Request` 后经**与 HTTP 同一个 cookie 门**进入路由：`Http.fetch` 增加可选 `opts?: { renew?: boolean }`（缺省允许续期，套接字传 `false`）；`authMiddleware` 增加同一选项——cookie 分支改走 `Auth.validate`、不写 Set-Cookie（Bearer 分支在帧头白名单下天然失效）。`fetchAs`、按用户缓存的路由树（`asUser`）与 `enteredAs` 删除——不再有以受信 `userId` 为入参的第二入口，用户是谁永远由门从凭证读出。`HttpModule.setup` 对同一批路由组每服务器各组装两张树：HTTP 入口在续期门后，套接字入口在同一门逻辑、`renew: false` 之后。授权、校验、错误形状因此与 HTTP 一致：套接字上的 `404` 就是 HTTP 的 `404`，`403 human_required` 就是 HTTP 的那一个；`sessionVia` 是门从会话行读出的**真读数**（不再写死 `password`）——token 换来的 Remote 会话在套接字上保持 token 级，`requireHuman` 守的人专属写照 HTTP 拒绝。`Response` 的编码只看 `content-type`：`text/event-stream` 逐事件编帧（解析 `id:` / `event:` / `data:` 行），其余按一次性响应处理；平台拒绝的路径（`/api/auth`、`/api/hmr`，加上 `sessionKindPath` 的各路径——`/api/me/password`、`/api/desktop*`、`*/dirs/access`、`*/reveal`）答 `421 not_on_socket`，客户端改经 HTTP；`/api/me`、`/api/install` 仍由客户端固定走 HTTP。协议整个在平台层：一次推送就到每台已安装的壳，之后怎么改也都是推送。
- **续期不变式（规范性）。** 只有 HTTP 应答续期，且续期必随同一应答 Set-Cookie（`authMiddleware` 现状即如此，保留）；握手不续期（`Auth.validate`）、套接字调用不续期（`renew: false`）、心跳不续期（既有纪律）。套接字的应答不携带 Set-Cookie——这里指**当前实现不在升级与帧应答上写它、本设计也不依赖在那里写它**，不是规范上的禁止；由此行与 Cookie 永不失同步：两者一起过期，或一起被刷新。一个流量全在套接字上的标签页，其会话由**固定走 HTTP 的那批调用**刷新——`/api/me`（载入与聚焦时的 `probeSession`）、签到签出、`sessionKindPath` 各流——Cookie 刷新正随这些应答走回；整天只用套接字、从不重新聚焦的页面在 TTL 到点登出，这是「连着 ≠ 被碰过」政策的直白后果，与 SSE 纪律同源。
- **身份属于开出它的那条会话**：逐调用验证的对象是交接下来的 token，不是浏览器此刻的 Cookie。另一标签页以别的用户签到会替换浏览器 Cookie，但已开套接字的身份不变、其原会话行也未被吊销——逐调用验证照常通过，语义与今天一条 SSE 流开出后 Cookie 被换走完全一致；把页面带回新身份的是客户端自己的联动（`/api/me` 的应答说出新用户→`identityIs` 关旧套接字、下次调用按新用户重开）。同用户多标签页＝同一 Cookie 多条套接字，互不干扰；一条吊销（登出）只收同名会话的连接，其余会话照常。
- **威胁模型与非目标。** 握本地 API token 者（工具子进程、读到 api-token 文件的人——即管理员权限）：可换 Remote 会话，但套接字上保持 token 级，`requireHuman` 路由 403，1 小时上限对开着的套接字生效。被吊销/过期的会话持有者：下一次调用即 401，无调用时由心跳在至多一个周期内关闭（见「收回与吊销」）。跨源页面：握手 Origin 检查，不变。改过的客户端伪造帧：帧带不进凭据（白名单丢弃在前、盖章在后），套接字只服务开它的那条会话。平台自身（插件）本就可信——`AuthService` 就在平台里，铸新会话本就是平台的能力，交给它一枚既有 token 不扩大任何权限（此判断写入 Drawbacks 供质疑）。同机其他 OS 用户界外（数据根即边界）。非目标：per-Session credential（设计 PR #235，结构性后继）、逐调用的人在场证明、新认证服务/新凭证类型/新注册表/新定时器、帧协议改动、改 CSRF 模型（`jsonOnlyWrites` 对盖上章的 `Request` 生效）。

### 收回与吊销

- **登出本会话。** 行删→该套接字**下一次调用**即 401（客户端两种传输上的 401 都触发全局登出并关套接字）；已订流由自己的 SSE 心跳在至多一个周期内 `finish`。
- **`signOutEverywhere`（改密码、删用户）。** 行全删，并对挂在本代注册表里的套接字**当场**（同一调用栈内）发起关闭：套接字登记进**既有**的 `LiveStreams` 注册表（`end`＝关闭套接字；挂进 attach 时所在 App 的注册表，连接关闭即除名），`signOutEverywhere` 从此一并收 API 套接字，不新增注册表。注册表随 App 代际更替、换代新建：**旧代注册的套接字不在新表里，跨代的收回不保证立即发生**——这是 SSE 今天的 best-effort 语义，本篇照单沿用，不另行设计重绑定。兜底是逐调用 401 与套接字心跳的查活——这两查都不经过注册表、直接问行，且两代 App 读同一份 web.db，换代替换不了它们。
- **行过期**（30 天 TTL；Remote 1 小时）。下一次调用 401；无调用的空闲套接字由心跳查活在至多一个周期内关闭——既有心跳（20 秒拍）加一步 `sessionIsLive`（明确不续期），不活即关，不新增定时器。流式调用的收回不需新代码：`streamRevocation` 本就从请求读 Cookie，如今读到的就是盖上的那枚真 token，SSE 的两层收回对套接字上的流原样成立。
- **时限口径（全篇统一）。** 一个周期＝`HEARTBEAT_MS`（20 s 量级）；各处上界均为「事件发生后至多一个周期」，且**非硬实时**——进程调度与事件循环的延迟另计；「当场」仅指注册表路径在同一调用栈内同步发起。与 SSE 的收回同级。

### 续传、心跳、背压

- 流式调用的续传就是端点自己的续传：`last-event-id` 头进 `Request`，端点从有界环形缓冲补发，挤出缓冲则先发 `resync_required` 事件——与 HTTP 传输上完全一致。客户端为每个流式调用记住最后的 `eventId`，重连后以它重发。
- 服务端以协议级 ping 探活，间隔与 SSE 心跳同一常量，每一拍同时查一次 `sessionIsLive`（不续期），行不在或不活即按「收回与吊销」的纪律关闭；连续错过 pong 即关闭套接字，其上所有调用按取消处理（流式调用退订，一次性调用的响应丢弃）。客户端在同样的时间尺度内没有任何帧到达即主动关闭重连；重连按指数退避，上限与机器 ssh 重连的上限同一量级。
- 背压：每条套接字有发送缓冲水位。积压超过水位时，服务端结束积压最多的流式调用（`end` 带 `reason: "lagging"`），客户端按重连流程以 `last-event-id` 重发——补得回的从缓冲补，补不回的走 `resync_required`；不无界排队，与终端流对滞后 viewer 的处理同一原则。

### 机器

- 路径以 `/server/<machineId>/` 开头的调用进入现有的机器转发层（`machines/proxy.ts` 的判据与答复不变：机器未连接即 `503 not_connected`，浏览器的凭据不过去、机器的不回来）。
- 转发层对每台已连接机器维护**至多一条**到 `ws://127.0.0.1:<remotePort>` 上 `api-socket@admin` 终端流路径的套接字：经该机器的连接拨出（`transport/connection.ts` 的 dial），以 `remote-token.ts` 铸造的 1 小时 `cli` 会话认证——机器那端的运行时核对 owner 后，同样把会话 token 交给机器的平台，机器的门逐调用验证：`via` 按 `auth-token.ts` 的既有语义读作 `password`，与旁路时代权限一致，只是如今由真凭证挣得、并受铸币 1 小时上限约束（铸币到期由心跳查活关闭，中继的下一次拨号重新铸票，缓存 ≤50 分钟本就重铸）——在第一次需要时建立，随 ssh 会话起落；被 hold 的机器随会话常驻，未 hold 的按会话同样的空闲规则关闭。
- 流式调用一律经机器套接字转发：去掉 `/server/<machineId>` 前缀后作为一次 `call` 发给机器，机器回来的帧改回浏览器那边的 `id` 转发。ssh 会话掉线时，该机器上所有进行中的流以 `end`（`reason: "not_connected"`）结束，浏览器据此维护离线机器集合（`offlineMachineIds`），会话回来后按重连流程重发。
- 流式调用**不回退 HTTP 转发**：那等于每台机器、每条流各占一条通道，机器一多就回到本提案要拆掉的那堵墙。拿不到套接字时立即以原因作答，浏览器按该流自己的退避（1 s 起倍增到 30 s，打开后归零）重发：机器拒绝握手——构建里没有套接字，或旧运行时开而未服务任何帧即关（**此判读是本篇拟议新增的**：转发层今天不区分「开而即关」与服务中途关闭，需随本篇补上，落成后套用既有记忆）——记住一分钟，需更新该机器，答 `502 machine_socket_refused`；拨号 10 s 内既未打开也未失败即拆掉，答 `502 machine_socket_unavailable`；已打开的套接字上 8 s 内未打开该流（套接字仍在心跳却不服务）即拆掉套接字，答 `504 machine_stream_not_opened`。两段期限之和小于浏览器自己的 20 s 流打开期限。
- 套接字按「机器 + 拨出它的 ssh 会话」缓存，不只按机器：传输层重开会话后，旧会话上的套接字（或尚未完成的拨号）作废并关闭，下一条流经新会话重拨。任何等待都有期限——一次卡住的拨号不能让该机器之后的所有流排在它后面。
- 一次性调用本阶段仍可走既有的 HTTP 转发（一次 SOCKS 拨号一个请求）；迁到机器套接字是纯优化，不改语义，留给实现按需决定。

### 前端

- `api/client.ts` 的 `apiFetch` 在套接字可用时经套接字发出调用，否则经 HTTP；两条路的错误形状相同（`ApiError` 带状态与正文），调用方不感知。多部分正文与二进制响应固定走 HTTP。
- `api/sse.ts` 由套接字客户端替代：单例、惰性打开、按进行中的调用计数管理生命周期；`openUserEvents` / `openSessionStream` 签名不变。`state/sessions.tsx` 中「每台机器一条流」的 effect 变为「每台机器一次流式调用」。
- 页面卸载或最后一个调用结束后套接字关闭；标签页在后台时保持，由心跳维系。

### 升级、错配与发布单元

- **插件重装（同壳换 inner App）与热推送（换壳）是两件事。** 插件重装：外壳与已开套接字都不断，逐调用继续解析「此刻的 App」——新代即刻接管在途调用，`renew: false` 的正门照走，权限随共享 web.db 里行的事实同步；但重装与推送一样**重建随 App 走的 `LiveStreams` 注册表**（换代新建、上一代不在表内）——旧代注册的套接字不保证被 `signOutEverywhere` 立即收回，兜底见「收回与吊销」。热推送：新壳 `create` 认领前壳的 socket 资源、宽限（`RECONNECT_GRACE_MS`）后以 1012 关闭其全部 API 套接字；前壳的 inner 已随推送处置，宽限内的调用按外壳既有语义答 503；客户端带各流 `last-event-id` 重连，重连经新握手重新交接凭证——闭包不跨壳迁移，重连即交接。
- **错配矩阵（fail closed）。** 运行时＝携带 `terminal/ws.ts`/`PlatformApi` 的应用构建，平台＝推送的 bundle：

| 运行时 | 平台 | 行为 |
| --- | --- | --- |
| 旧 | 旧 | 现状（不劣化） |
| 新 | 旧 | 旧平台忽略第五参、照旧走旧门——与现状等价，新运行时无副作用 |
| 旧 | 新 | 平台拿不到凭证→api-socket 立即关闭；浏览器标签页按既有放弃路径退 HTTP/SSE；机器拨号读作拒接→`502`；**没有一条路径在无凭证下服务调用** |
| 新 | 新 | 本设计 |

- **发布单元（原子验收）。** 删除 `fetchAs` 的那一刻，调用方改写若不在同一棵树里，平台代码无法编译——**接口删除、调用方切换、凭证盖章与测试属于同一个原子可验收发布批次**，不称各编辑步骤可独立绿。由此只有两个发布单元：**平台单元**（一次热推送：全部平台侧改动与测试在同一棵树里编译、过套件，并验证错配矩阵「旧运行时＋新平台」的行为——其中「开而即关＝拒接」是本单元新增的判读，不是现成保证）；**运行时单元**（一次应用构建：`terminal/ws.ts` 改用 `Auth.validate`、`attachStream` 第五参、`PlatformApi`/`PlatformIface` 版本递增）。两单元先后任意（错配矩阵兜住），单元内部不拆分。
- 编辑顺序只说明同一单元内先动哪几行：① `auth/service.ts`：`Auth.validate`；② `auth/middleware.ts`：`{ renew: false }`；③ `http/app.ts`：删 `fetchAs`/`asUser`/`enteredAs`，双入口两张树；④ `hmr/platform.ts`：外壳 api-socket 分支（第五参、fail closed、盖章闭包）；⑤ `socket/serve.ts`：盖章、注册表登记、心跳加 `sessionIsLive`；⑥ `machines/machine-sockets.ts`：新增「开而未服务任何帧即关＝拒接」的判读；⑦ `api/types.ts`：仅更新 `sessionKindPath` 的注释与理由（集合不动）；⑧ 测试：改写旁路断言为凭证门断言并按下方矩阵增补，既有用例无一删除；前端无必改项（联动已在）。
- **验证矩阵（实现轮的验收单）。** 「今天」栏是对 impl #912 头源码的静态判读，本篇作者未做动态验证、不称已复现；实测随实现 PR 的 Verification 一节回填。

| # | 场景 | 今天 | 拟议 | 怎么验 |
| --- | --- | --- | --- | --- |
| 1 | Remote 会话经套接字调 `requireHuman` 写 | 通过（提权） | 403 `human_required`，与 HTTP 同一答复 | 服务端测试：铸 `remote` 行开套接字发调用 |
| 2 | 登出本会话 | 套接字照旧服务 | 下次调用 401、新握手 401；空闲时心跳至多一个周期（约 20 s、非硬实时）关闭；已订流随 SSE 心跳结束 | 服务端＋jsdom：401 联动关套接字 |
| 3 | `signOutEverywhere`（改密码/删用户） | 套接字照旧服务 | 本代注册：当场同步发起关闭；跨代遗留：不保证立即收回，逐调用 401＋心跳兜底 | 服务端测试：开套接字后 resetPassword；另一例先重装再 resetPassword 验兜底 |
| 4 | 行过期、空闲套接字 | 永不觉察 | 下次调用 401；心跳至多一个周期关闭（非硬实时） | 服务端测试：拨行过期时钟 |
| 5 | 套接字流量续期 | 调用不续、握手续 | 调用与握手均不续；行过期时刻不动 | 服务端测试：N 次调用后行 `expiresAt` 不变 |
| 6 | HTTP 续期随 Set-Cookie | 现状 | 不变 | 既有用例照跑 |
| 7 | 旧运行时形态（无第五参） | — | api-socket 随 attach 即关；页面退 HTTP/SSE；机器拨号经**拟议新增**的拒接判读落 `502`＋60 秒记忆（非现成保证） | 服务端测试：不传 credential 的 attach |
| 8 | 帧头塞 `cookie` | 白名单丢弃 | 同（盖章在其后） | 既有白名单用例＋盖章顺序断言 |
| 9 | 机器中继铸币到期 | 心跳不查、套接字带死票续命 | 心跳关闭→重拨→重铸 | 中继夹具：拨时钟 |
| 10 | 插件重装（同壳换 inner） | 套接字不断、照旧服务，无注册表参与 | 套接字不断、正门照走；注册表换代→旧注册不保证立即收回，逐调用 401＋心跳兜底 | 服务端测试：开套接字→重装→resetPassword，观察兜底路径 |
| 11 | 热推送（换壳） | 1012（宽限）关＋重连 | 不变；重连重新交接凭证 | 既有用例照跑 |
| 12 | 421 集合与 `CALL_HEADERS` | 现状 | 不变 | 既有用例照跑，无一删除 |

## Drawbacks
[drawbacks]: #drawbacks

- 重连与续传逻辑从浏览器内建的 `EventSource` 搬到自己的代码里：退避、重发、`eventId` 记忆都要写、要测。
- 一条套接字是单点：它一断，所有调用同时断。但它也同时续——比今天 N 条各自断、各自续、各自撞运气更可推理。
- 套接字借终端流的入口进门：地址是一个终端 id 的形状（`api-socket@<userId>`），而不是一条自己的路径。这是把「不新增 upgrade 入口」放在「路径好看」之前的结果；若某天运行时因别的原因重装，可以补一条 `/api/socket` 的别名，但保留 id 仍要保留——已安装的壳只认它。
- 编帧要解析 SSE 文本再编成 JSON，多一次编解码；代价与它省下的 N 条连接相比可以忽略，但它确实是一层。
- 机器转发层多持有一类长连接（每台机器一条），其生命周期要与 ssh 会话严格对齐，否则会出现「会话已死、套接字还在」的幽灵调用。
- **逐调用成本**：套接字每次调用多付一次行查找＋用户查找——HTTP 每请求本就付同样的钱，SSE 每拍每流也付；但这确实是相对「每用户缓存一张树、门里一次 `findById`」的旁路时代多出的部分。
- **凭证进平台**：握手 token 交给推送代码。威胁模型论证不扩权——`AuthService.issueSession` 本就在平台手里——但「平台持有一枚现成 token」与「平台能铸新行」在字面上仍是两件事，此判断接受审阅。
- **两张树**：同一批路由组每服务器组装两次（每传输一张门），比「每用户一张」省得多，但仍是重复挂载；若嫌重，可在实现里探索单树＋门内判别（需一个不可伪造的进程内标记，本篇不替实现做此选择）。
- **全天套接字、从不聚焦的标签页在 TTL 登出**：「连着 ≠ 被碰过」政策的直白后果，对个别长开页是体验回退；解法（提醒帧触发 HTTP 刷新）会让空闲页也续期，违背同一政策，故不取。
- **升级窗口**：旧运行时装上新平台期间套接字拒开，那些安装退回 1+N 条 SSE 的形态（本篇要解决的问题暂时回来）直至应用更新；是降级，不是破坏。

## Rationale and alternatives
[rationale-and-alternatives]: #rationale-and-alternatives

- **一套专门的订阅协议（`subscribe { channel }`），与 REST 并列。** 本提案的前一稿。不选它：那是第二个 API 面——通道有自己的标识、自己的授权判定、自己的错误码，每一样都是对既有端点的复述，且从此两边要同步演进。把套接字做成**传输**，端点仍是唯一的 API 面，授权与错误形状天然一致，运行时也不用认识任何端点。
- **只做服务端扇入、传输仍用 SSE。** 浏览器从 `1 + N` 条降到 `1 + 打开的会话页数`，六条配额通常够用，改动最小。不选它作为终态：数量仍随会话页增长，终端并入无从谈起，半死连接仍无协议级探活。
- **HTTP/2。** 单连接多路复用是它的本职，前端一行不改。不可行：浏览器只在 TLS 上说 HTTP/2，而桌面端在回环、手机经隧道，全是明文 HTTP；为此引入证书是另一套问题。
- **每样东西一条 WebSocket。** 配额从六条变两百多条，症状消失；但同源代理要学会透传 Upgrade，机器仍是逐台从浏览器拨，半死连接的探活要每条各做一遍。把墙推远，不是拆掉。
- **什么都不做。** 机器一多、会话页一多，页面就慢；这是已经发生的事。

选「一条套接字 + 等价的异步 API 调用」，是因为它把连接数从一个随对象增长的变量变成常量 1，不引入第二个 API 面，且顺手把机器那一半放回本来就握着 ssh 的那一层。

**身份为什么走正门。** 本篇前一稿让套接字以「被运行时证明过的用户」进门：`Http.fetchAs(userId, request)` 把整批路由组在该用户门后重挂一遍、`sessionVia` 写死 `password`、不查会话——以「零运行时改动」为卖点。对照实现（impl #912）核对后判定不可保留，四个缺口同根：token 换来的 Remote 会话在套接字上以人的权限通过 `requireHuman`（提权）；改密码、删用户后已开的套接字照常服务（不吊销）；会话行在开着的套接字下过期而无人察觉（不查过期）；握手续期而套接字应答带不回 Set-Cookie（续期失配，行可以活得比证明它的 Cookie 久）。病根是结构性的：一个以受信 `userId` 为入参的第二入口，就是让今后每条路由都得记得「这条路上的 `password` 是假设」；服务端的 `sessionKindPath` 黑名单存在的唯一理由就是替这个假设挡答案随 `via` 变的路径，而它已经漏了 `requireHuman` 那批。黑名单会不断长，凭证不需要黑名单——权限不靠敏感路由黑名单来补。

- **保留 `fetchAs`、把真 `via` 随握手传进去**（只修提权）：`password` 变诚实了，但信任形状没变，仍是「受信 userId 进门」，吊销与过期仍要另配机制。修一个戳记不拆一扇门。
- **只在心跳里查活、不做逐调用门**：吊销到下一拍之间的调用照服务，且拍间的 `sessionVia` 仍是假设。SSE 能接受拍级是因为它的流只读；套接字上有写。逐调用的成本与 HTTP 等价，没有理由比 HTTP 宽。
- **握手时铸一枚套接字专用会话**：新凭证类型、新吊销面、中继与机器各要一份——恰好违反「不新增凭证」；「没有新的凭据」本就是卖点，保留它。
- **在升级应答上写 Set-Cookie 拉平续期**：当前实现不这么做，本设计也不把鉴权模型押在「浏览器处理升级应答里的 Set-Cookie」这种未被本仓依赖的行为上；「续期只随普通 HTTP 应答走」更易声明也更易测，简单的一侧胜。
- **什么都不做**：提权与不吊销照旧。

选「凭证走正门」，因为它把旁路时代的四个缺口收敛为**同一个**原因的消除：身份由凭证在门内读出，授权、`via` 与逐调用的吊销/过期判定都是既有机制的自然延伸——注册表一代之外的收回沿用既有 best-effort 语义、靠逐调用与心跳兜底——不需要黑名单追赶，也不需要新信任面。

## Prior art
[prior-art]: #prior-art

- 本仓库：终端流的帧头从第一天就带 `slot` 字节，注释写明「把一页的所有终端复用到一条套接字是显然的下一步」；`machines/terminal-relay.ts` 已经在服务端用 `ws` 库把浏览器的终端套接字桥到机器——机器扇入照它的形状；`ChannelHub` 的单调 id 与环形缓冲、SSE 的 `resync_required`，就是本提案的续传契约。
- 本仓库自己的 SSE（`http/sse.ts`、`auth/live-streams.ts`）：注册表收回＋每拍重查＋永不续期三条纪律，套接字逐条采纳——同一台服务器上，长连接的鉴权纪律早已有定论，套接字只是迟到。cookie 门本身（`auth/middleware.ts`；route-group-gate 修订）：套接字加入它，而不是平行复制它。
- VS Code Remote：编辑器与远端之间一条连接，其上复用全部服务；扩展主机、终端、文件系统都是它上面的通道。
- Phoenix Channels / Socket.IO：一条套接字、按 topic 订阅、每条消息标注 topic；重连后由客户端重新 join。

## Unresolved questions
[unresolved-questions]: #unresolved-questions

- ~~终端并入是否与本提案同一批落地~~ 已定：**终端不并入**——终端流是吞吐优先的数据面，API 套接字是延迟优先的控制面，一条 TCP 流给不了两样（队头阻塞、共用一个发送缓冲、背压只能按整条连接量）；而 WebSocket 本就不占浏览器六条 HTTP/1.1 的配额，并入对本提案要解决的问题零收益。每个打开的终端面板一条自己的 WebSocket，数量以面板数为界。
- 一次性调用是否第一批就经套接字。建议是：`apiFetch` 的传输切换是一处改动，且它让「套接字可用时零 HTTP 连接」成立；但若实现顺序需要，先只迁流式调用也成立。
- 机器的一次性调用是否迁到机器套接字（见「机器」末条），留待实现。
- 发送缓冲水位与 ping 间隔的具体取值，留待实现按终端流与 SSE 的现有常量对齐。
- `sessionKindPath` 的去留：`via` 成为真读数后，它在服务端的原始理由（替「假定为 password」挡答案随 `via` 变的路径）消失；保留它是作为客户端契约（身份发现与设 Cookie 的流程留在 HTTP）与纵深。建议本轮**冻结不动、不再增长**，待 per-Session credential（设计 PR #235）落地后一并裁撤——是否接受此节奏，请审阅者定。
- 关闭码与原因字：吊销关闭、无凭证拒接、过期关闭三处的码值（及「开而未服务即关＝拒接」的判读）留实现轮按 `ws` 库与既有 close 语义定，行为要求已在 Reference 固定。
- `Auth.validate` 是否也该替换 SSE 心跳现用的 `sessionIsLive`（后者不查用户行）——不必：删用户时行随外键级联删除，两读数等价；留实现轮若有反例再议。

## Future possibilities
[future-possibilities]: #future-possibilities

- **终端的多路复用，如果有一天需要。** 终端不并入 API 套接字（见 Unresolved questions），但若某天"每个面板一条 WebSocket"本身成了问题，正确的形态是**所有终端共用一条独立的二进制套接字**——帧头里的 `slot` 字节从第一天就为此预留——而不是并进这条 JSON 的控制面。
- **CLI 上套接字。** 它说的是同一个 API，换传输只是换客户端；`penguin chat` 之类的长会话届时可以复用同一客户端。HTTP 端点即便到那时也不必删——它是传输之一。
- **第三种传输。** 一个 API server 有了两种传输，就可以有第三种：stdio（给本机的编辑器插件）、或一条 Unix socket（给本机的 CLI 免鉴权）。本提案不做，只说明形态允许。
- **per-Session credential（设计 PR #235）。** 落地后 `requireHuman` 变为结构性判断（「Session 的凭证拒绝，人的登录不拒」——其注释原文），套接字无需再改：一枚 per-Session token 只是门会诚实读出的又一种 `via`。届时可一并裁撤 `sessionKindPath` 与「人专属写」的黑名单维护。

## Changes

### v1.0.0

- 新增：迁入主仓；正文取设计仓的同一版本，与英文版逐节对应。
