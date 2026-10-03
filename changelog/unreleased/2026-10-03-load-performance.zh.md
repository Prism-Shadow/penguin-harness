# 长对话与长 Trace 文件打开不再卡顿

- **Date:** 2026-10-03
- **Type:** fix
- **Scope:** `web`, `server`, `docs`

[English](2026-10-03-load-performance.md)

长对话以及 Trace 面板中的长 Trace 文件，加载时不再让页面卡住。对话打开时加载的 Task 更少，历史分页有字节上限、图片改为链接下发，Trace 面板按轮次逐个读取，不再读取整个文件。

## 历史窗口

- 打开对话时加载最新 20 个问答对（原为 50），每次滚动到顶部再加载 20 个（原为 50）。
- 分窗读取的历史页（带 `tailLimit` 或 `before` 的 `GET /api/sessions/:sessionId/messages`）另受字节预算约束：加入下一个 Task 会使序列化后的消息超过 4 MiB 时即提前收口，但一页至少含一个 Task。提前收口的页同样带 `before` 游标。

## Trace 面板

- 打开 Trace 文件时先请求其分析结果，再按最新一轮的消息范围只读取该轮事件（每次请求至多 1000 条），不再读取文件中的全部事件。最新一轮默认展开并滚动到可见位置；其余轮次折叠、只显示统计标签，首次展开时才读取各自范围内的事件。
- 面板渲染最新 50 个轮次卡片，其上方的「更早的 N 轮」每点一次再展示 50 轮。
- 运行中刷新时重新请求分析结果，只重读范围有变化的已展开轮次，新结果到达前保留已显示的消息；仅当最新一轮处于展开状态时，新出现的一轮才自动展开。读取失败的轮次在消息位置显示错误，重新展开或下次刷新时重试。
- 上下文圆环读取分析结果新增的 `modelContextWindow`（文件开头 `session_meta` 中的上下文窗口），旧版服务端未提供时按 128k 计。
- 轮次事件中的图片仍以 `data:` URL 内联下发，含截图的一轮可能达数 MB；改为按引用读取留待后续。

## Trace 事件接口

- Trace 事件读取（`GET /api/projects/:projectId/agents/:agentId/traces/:sessionId/:index` 与 `GET /api/sessions/:sessionId/traces/:index`）每页由按文件维护的行索引（记录的字节偏移，最多缓存 32 个文件，文件增长时增量扩展）一次范围读取得到，不再每页解析整个文件。

## 图片按引用下发

- 分窗历史页把主会话记录中的 PNG、JPEG、GIF、WebP `data:` URL（用户的 `image_url`，或工具输出 `images` 中的一项）替换为 `/api/sessions/:sessionId/trace-image?file=<fileIndex>&ordinal=<ordinal>[&i=<k>]`。新路由从 Trace 记录解码该图片，以不可变的私有缓存返回。子会话消息、尚未写入 Trace 的暂存输入、其他图片类型以及无参数的全量读取仍保留 `data:` URL。
- 对话从 Session 所在的机器获取这些图片，且只在图片接近视口时才加载。读取历史页期间经流式通道内联到达的图片，仍只显示一次。
