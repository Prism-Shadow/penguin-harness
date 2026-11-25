# 一条 socket 承载每一条请求，不再放弃

- **Date:** 2026-10-26
- **Type:** fix
- **Scope:** `web`
- **PR:** [#1365](https://github.com/Prism-Shadow/penguin-harness/pull/1365)

[English](2026-10-26-one-socket-carries-every-request.md)

页面那条 API socket 现在承载每一条不属于「始终走 HTTP」那一小批的请求：socket 关着时发起的调用会排队，
握手成功一次就按序发出；只要手上还有调用或流要承载，客户端就按自己的退避一直重连。

## 细节

- 客户端不再在数满若干次握手失败之后停止连接。每次断线——连上过的连接没了、握手一直没开、服务器够不着
  ——都按那条指数退避（1 秒起、每次翻倍、30 秒封顶）排下一次尝试，只有手上不再有要承载的东西才停止排程；
  下一次调用或流会把 socket 再打开。一次失败的握手让退避前进一档，因此连续四次失败的重试间隔是
  1 秒、2 秒、4 秒、8 秒。`unavailable` 现在只剩一个来源：这个页面没有 `WebSocket`。
- API 客户端不再逐次退回 HTTP。除 `httpOnly` 那一批路径（`/api/me`、auth、`sessionKindPath`、hmr、
  install）之外，调用都进 socket 的队列，握手成功一次就按序发出。等待期间到达的调用与流不会自己开握手，
  它们等断线已经排下的那次尝试。
- 队列属于一代身份。登录、登出、本服务器的会话被判过期、`/api/me` 报出与上次不同的用户，这四条都换一代；
  旧代排在队里的调用以 `identity_changed` 结束，不交给下一个用户；同一个人重复确认则保留队列。在途身份探测
  的答案不会打开旧身份的 socket——改为重新问一次身份。整条队列在这几种情况下被拒：身份换代、这个页面没有
  `WebSocket`、没人登录、身份探测失败、构造 socket 抛错。
- socket 交回的应答按 `content-type` 判，与从 `Response` 上读到的那条同一份规则：文本正文的 `content-type`
  不含 `json` 时按「不是服务器的答复」报——`text/html` 报成一页，502、503、504 报成代理，其余类型报类型
  ——不当成数据交给调用方。标了 `json` 的正文解析后交回，解析不了则交回原文；空 body 保留原 status 与
  `null`。socket 上的应答没有代理头可看，网关那一支只按状态码判。
- 一批交给 socket 的调用逐条结算。序列化不了的 body 只结束那一条（`socket_unserializable`），发送抛错则
  拒掉那一条并关掉 socket 交给重连；其后的条目照常轮到。发不出去的流帧回到等待 socket 的那批流里，重连后
  重新发出。
- 流的传输、协议与服务端未动，调用方也没有多一行 `await`，没有新增 `online`、`focus`、`visibilitychange`
  监听。答案 deadline 从调用路径搬进了发送路径，种类与数量不变。队列没有上限，也没有发出前取消。
