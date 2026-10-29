# 套接字上的流可控速，机器以 Trace 行提供历史

- **Date:** 2026-10-29
- **Type:** feature
- **Scope:** `server`, `core`, `web`, `docs`
- **PR:** [#1391](https://github.com/Prism-Shadow/penguin-harness/pull/1391)

[English](2026-10-29-history-stream-source.md)

API 套接字上的流式调用可以用 `x-flow: credit` 请求确认流控：客户端回报已处理的事件数据量，服务端在途的未确认数据不超过实测送达速率的 2 秒量（介于 32 KiB 与 1 MiB 之间），一次大传输不再在套接字的其他调用之前堆积几分钟的数据。流在等待期间可以发出具名 `ping` 作为节拍；一次性调用在应答读取期间被释放后，不再收到多余的 `200` 应答帧。

服务端之间的套接字，以及通往另一台电脑上浏览器的套接字，以 permessage-deflate 压缩各帧；同一台电脑上的浏览器（含桌面端）不压缩。

每个服务端都为自己的 Session 提供 `GET /api/sessions/:sessionId/history-lines`：先给出历史窗口的信封与其记录所在 Trace 字节的布局，再只发送调用方尚未持有的 Trace 行——只发整行、最新的在前、每帧至多 32 KiB，更长的单行拆成若干片。调用方持有的范围按文件身份、大小以及首尾字节的散列校验，校验不过的文件从头重发。`GET /api/sessions/:sessionId/trace-body?ref=` 取回一个被折叠的值的全文。

core 的 `interfaces` 子路径新增历史窗口使用的折叠规则：超过 16 KiB 的工具输出、子 Agent 会话的内联图片、工具调用参数中的长字符串与思考文本只保留开头与结尾的一小段，并附一条 `elided` 记录指明该值，展开时据此取回全文。
