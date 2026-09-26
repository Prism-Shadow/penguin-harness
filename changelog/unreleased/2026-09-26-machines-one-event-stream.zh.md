# 每台机器一条事件流，静默的流会被发现

- **Date:** 2026-09-26
- **Type:** feature
- **Scope:** `server`, `web`, `docs`

[English](2026-09-26-machines-one-event-stream.md)

无论有多少台机器，hub 对每台机器只持有一条连接，对每个读者只持有一条流。此前浏览器标签页会把机器的
`GET /api/events` 当作自己的一条流打开，于是 hub 要承担（标签页数 × 机器数）条上游流，一台卡住的机器
会按标签页数量放大它的重发风暴。现在 hub 通过它本就持有的、通往该机器的 API socket，只订阅每台机器的
事件**一次**，自己保留一个有界的重放缓冲，并从缓冲里服务每一个读者。标签页只持有一条流，它承载所有已连接
机器的事件，每条都带上来源机器的标记；单台机器的那条流由同一次订阅服务，因此在读者看来，它的事件与
`last-event-id` 语义与从前完全一致。

## 细节

- `GET /api/projects/:projectId/machines/events` 是聚合流：每个标签页一条响应，仅限 admin 与项目成员，
  流会立刻打开，并随着每台被关注机器的 socket 就绪而填充，因此一台迟迟连不上的机器不会拖住整个标签页的
  流。它的帧是 `event: machine_event`，数据为 `{"machineId","event"}`——该机器自己的某个 server event——
  外加 hub 自己的 `server_event` 帧（`hello`、`resync_required`）和 `heartbeat`。`Last-Event-ID` 由 hub
  自己的有界缓冲（10 000 条事件 / 8 MB）应答，并按该标签页关注的机器过滤，因此重连是由一个比写入它的那条
  流活得更久的缓冲来服务的。
- 本服务器通往机器的 socket 被抽出为 `machines/machine-sockets.ts`，由流转发与 hub 共用：每台机器只拨号
  一次，拨号期限 10 秒（在传输层自身期限之上），握手被拒时在随后的一分钟内以 `machine_socket_refused`
  应答，socket 无法建立时以 `machine_socket_unavailable` 应答。机器在 8 秒内没有打开的流会拆掉该
  socket（其上的每一条流都会结束并重发，于是下一次拨号能到达机器当前的 App），并以
  `machine_stream_not_opened` 应答。
- **已打开流的活性。**本服务器的 `/api/events` 与每台机器的 `/api/events` 现在除了 `: ping` 注释之外，
  每 20 秒还会写入一个 `heartbeat` server event（`http/sse.ts`，`HEARTBEAT_MS`）——注释对一切读取事件而非
  字节的东西都是不可见的。hub 会结束一条已经漏掉两拍的上下游，取消它并带着该机器的 last event id 重新
  订阅；它的读者保留自己的流，什么都不会漏掉。标签页用同样的方式给自己的流计时：API socket 客户端会结束
  一条静默两拍的流，并带着它的 `last-event-id` 重发，这本就是现有重发逻辑在做的事。停止消费聚合流的读者
  会被结束，而不是被无界缓冲——这正是 socket 自身 `lagging` 规则下移一层的样子，每个读者 4 MB 高水位。
- **Machines 页面**显示本服务器通往每台机器的 socket 状态：`connected`、`dialling`、`refused` 或
  `failed`，以及进入该状态的时刻，因此卡住的流不必再去浏览器控制台里找。这一事实由 `MachineInfo.socket`
  承载（`MachineSocketFact`），对于本机、以及在还没有任何流请求过 socket 之前为 null——它是关于本侧某个
  进程的事实，说明 socket 存在、以及它在做什么，从不表示对端正在应答。
- 聚合端点是新增能力，机器自身的那条流在线上没有变化，因此用旧构建的页面连到运行本次变更的服务器时，
  仍会使用它所知道的每机器流。没有数据或配置需要迁移。
