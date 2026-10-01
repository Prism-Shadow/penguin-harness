# Web App 与服务端之间只持一条套接字，所有流都是它上面的调用

- **Date:** 2026-09-07
- **Type:** feature
- **Scope:** `server`, `web`
- **PR:** [#912](https://github.com/Prism-Shadow/penguin-harness/pull/912)

[English](2026-09-07-single-socket.md)

此前 Web App 为每个长期订阅各开一个不结束的 HTTP 响应——本服务端的 `/api/events`、每台已连接机器一条 `/server/<id>/api/events`、每个打开的会话页一条 Session 流；而浏览器对同一 host 只允许六条 HTTP/1.1 连接，几台机器加一个会话页就让页面自己的请求排在它们后面，经代理转发的流在半路死掉时也永远不归还槽位。现在一个标签页只向服务端持一条 WebSocket，所有长期的东西都是它上面的调用；服务端对每台已连接机器也只持一条套接字，机器的流经它转发。设计见 PRFC-0011。

## 细节

- 套接字是同一个 API 的第二种传输：每个文本帧是对既有端点的一次调用——方法、路径、白名单里的头（`last-event-id`、`accept`、`content-type`）、JSON 正文——应答带回客户端会读的 `date`、`content-type`、`retry-after` 与 `etag`；调用进入 HTTP 请求所进入的同一批路由，因而授权、校验与错误形状都是端点自己的。`text/event-stream` 响应以一帧 `stream` 开始、每条事件一帧、以 `end` 结束；`cancel` 帧释放它。套接字按 SSE 心跳的节奏 ping，两拍无应答即断开；发送积压超过水位的客户端，其流以 `lagging` 为由结束而不无界排队。运行时自有的前缀（`/api/auth`、`/api/hmr`、`/api/desktop`）回 `421 not_on_socket`，改经 HTTP 发起。
- 它在终端流的 upgrade 路径上打开，用一个以登录用户命名的保留 id：`GET /api/terminals/api-socket@<userId>/stream`，终端管理器的查找以一个引用作答，平台据此为它服务套接字协议。握手就是终端流的握手——会话 Cookie、同源、id 的 owner 必须是登录用户本人——之后平台以该用户身份进入自己的路由（`Http.fetchAs`）。一切都在平台层：已安装的壳在承载它的平台被推送后立即提供套接字，运行时无需改动。
- 机器代理把流式请求（`accept: text/event-stream`）经它对该机器持有的一条套接字（经该机器的 ssh 会话、以其 admin 身份拨出）转发，再把帧还原为 `text/event-stream` 响应。流从不回退到 HTTP 转发——那样每台机器的每条流都要占住一条通道：没有套接字承载时——机器拒绝握手（构建里没有套接字，记住一分钟）、10 s 内拨不通、或机器 8 s 内未打开该流（随即拆掉这条套接字）——该流直接以 `502`/`504` 带原因作答（`machine_socket_refused`、`machine_socket_unavailable`、`machine_stream_not_opened`）。套接字只在拨出它的那个 ssh 会话内复用；传输层重开会话时，旧套接字被关闭，下一条流重新拨号。
- 前端的 `apiFetch` 在套接字打开时经套接字发出调用、否则用 fetch，两条路一个代码路径；套接字拒绝承载的响应（415 `unsupported_transport`）改用 fetch。流（`openUserEvents`、`openSessionStream`）是套接字上的调用，在每次中断后——重连、服务端结束、机器没有套接字时的 5xx——都带着最后的事件 id 重新发出，每条流各自退避（1 s 起倍增到 30 s，打开后归零），并在控制台警告里写出服务端给的原因；401/403/404 则停止。握手持续失败时页面回退到 `EventSource` 与 fetch。
- 两个 SSE 端点与 `/server/<id>/api/…` 代理不变；CLI 继续经 HTTP 消费 SSE。

## 无人应答时

- 套接字由平台 shell 服务，其上的每次调用都进入当时的 App：插件变更在开着的套接字底下重组 App，不会把它搁浅。推送替换的是 shell 本身，因此开着的套接字交给后继者，由后继者在启动完成两秒后关闭（关闭码 1012，「the harness was updated; reconnect」）；浏览器随即重连，并按各流的 last event id 重新发起。带上这个改动的第一次推送仍由旧平台完成换出，当时开着的窗口需要刷新一次。
- 握手 10 s 内仍未打开的，由客户端关闭并重试；连续三次即放弃套接字，改用 `EventSource` 与 fetch，与被拒绝的握手处理一致。
- 单次调用 20 s 内无应答的即放弃，并以 `console.warn` 报出调用与套接字状态。读请求（`GET`/`HEAD`）改走 HTTP 重发；写请求报为网络错误，因为它可能已经生效。
- 流 20 s 内未打开的，取消后重新发起，附同样的警告。
- 本服务器对所有请求都未作答的 Session 列表 reload，按退避（2 s 起，翻倍至 30 s）重试，并以警告列出各请求得到的回答。
- 对话历史 15 s 后仍在加载的，记录这次调用去了哪里（本服务器还是哪台机器）以及套接字正在做什么。
