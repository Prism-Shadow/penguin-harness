# 服务端为所连机器保留一份 Trace 行副本，远程对话的历史从这份副本流式发出

- **Date:** 2026-10-29
- **Type:** feature
- **Scope:** `server`
- **PR:** [#1392](https://github.com/Prism-Shadow/penguin-harness/pull/1392)

[English](2026-10-29-history-stream-hub.md)

连接机器的服务端把每台机器发来的 Trace 行保留在 `<数据根>/machines/traces/` 下，远程对话的历史从这份副本以带进度的流发出。再次打开同一对话时，只向机器要副本里还没有的行；旧版本的机器也仍能加载历史。

## 细节

- `GET /api/sessions/:id/history` 以整条记录为行流式发送一个窗口，大块内容折叠，查询参数与 `/messages` 相同（`tailLimit`、`before` 加 `limit`、不带参数为完整记录），另加 `budget` 与 `fill=1`。每个事件的 id 为 `<windowId>:<offset>`，两分钟内带着这个 id 重新发起的流从原窗口的断点继续。本机的 Session 直接从自己的 Trace 应答。
- 机器上的 Session 由服务端经 API socket 调用该机器的 `history-lines` 路由，把完整的行写入一份按字节一致的稀疏副本，再从副本拼出窗口。每个对话一个同步任务，同一时刻只开一条机器流：窗口与正文优先，后台补全为它让路。15 秒没有任何帧的流被切断，并从副本处重新打开；机器不在线时从 1 秒起倍增到 30 秒重试，等待状态以 `progress.waiting` 告知；最后一个读者离开时立即取消机器流。
- 每次打开都校验副本：机器上被改写或替换的文件从头重来，机器不再列出的文件被删除。副本上限 1 GiB，超出时先淘汰最久未读的对话；机器连同数据卸载、或不再出现在本服务端的列表中时，删除它的副本。
- `GET /api/sessions/:id/trace-body?ref=` 完整发送一个折叠的值，来自副本，或在取回所在行之后。按引用的图片与 Trace 面板对整份文件的事件读取也从副本应答，其余请求照旧转发给机器。
- 没有 `history-lines` 的机器，其窗口在同一条流里经 HTTP 读取它的 `/messages`，边到达边计字节，不做缓存。
