# 会话搜索：凭「里面说过什么」找一段对话

- **Date:** 2026-10-13
- **Type:** feature
- **Scope:** `server`
- **PR:** [#1108](https://github.com/Prism-Shadow/penguin-harness/pull/1108)

[English](2026-10-13-conversation-search.md)

一段对话是靠内容被记住的，而不是靠它的标题、它属于哪个 Agent、或它发生在哪天。侧栏只能按后三者浏览，于是一个标题说不出什么的会话——所有自动命名的会话都是——实际上等于丢了。这里给 Trace 树加一份索引，并加上询问它的路由。

## 索引

- **`session_search`** 是一张 FTS5 虚表，覆盖每条被索引记录的文字；Project、Agent、Session、分片与行号作为 `UNINDEXED` 列随行携带，因此命中项能精确跳到匹配的那条消息。正文是记录的投影（`indexableProjection`），`raw` 保留片段截取所用的原文。
- **`session_search_shards`** 是每分片的账本：每个分片已消费多少字节，且总是在记录边界上，因此被追加的分片从上次停下处继续，而不是重读或读半条。
- 索引器走的是与 Trace 索引同一棵 `<agent>/traces/<yyyy-mm-dd>/<sessionId>_NNN.jsonl` 树，只取大小有变化的分片，并在预算用尽时停下——因此在大型安装上，第一次搜索会在其余部分仍在索引时就给出结果，状态路由会说明这一点。
- 该 pass 按短间隔运行，也在每次搜索时运行，因此一段对话在被说出口几秒后即可被找到，无需重启。删除会话或其 Trace 文件会一并移除它的行。

## 怎么问它

`GET /api/projects/:projectId/sessions/search`（刻意做成 Project 级——没人记得一段对话属于哪个 Agent；当侧栏分组生效时用 `agentId` 收窄）：

- `q` 必填，最长 200 字符；`sort` 为 `recent`（默认）或 `relevance`。
- 过滤：`agentId`、`from` / `to`（必须是真实日历日期，格式非法时拒绝而不是默默忽略）、`workspace`、`includeArchived`、`limit`（1–100，默认 30）与 `offset`。
- 每条结果带上该会话的列表行事实、匹配消息数、是否仅标题命中，以及最多三条匹配消息——每条含片段与「匹配区间在片段中的偏移」，面板因此可以高亮而无需重新搜索。
- `GET …/sessions/search/status` 报告索引进度，第一次搜索因此可以说「仍在索引」而不是「没有找到」。

**中文按子串检索。** FTS5 的分词器在这里没有可用的词边界，因此查询会被展开成单字与双字短语（`queryExpression`）——两字词能在一长串文字中被找到，靠的就是这一步。

## 把索引从「能搜」变成「能答」

- 查询文本不会在读路径上同步触发一次索引 pass：一次搜索最多等待 30ms 的追赶预算，因此索引落后时输入框依然跟手。
- 打开数据库时 `PRAGMA cache_size = -64000`：默认 2MB 页缓存是按嵌入式数据库定的，而用过一段时间的安装，web.db 往往在数百 MB 量级。

## 细节

- 服务端新增：`services/search-text.ts`（投影、查询展开、片段与标记偏移）、`services/trace-record-classify.ts`（一条 Trace 记录是什么，以及它是否开启一轮）、`services/session-search.ts`（索引器与查询）、`db/repos/session-search.ts`（两张表）、`http/routes/session-search.ts`，以及把它们接起来的 `ConversationSearchModule`。
- 测试：`search-text.test.ts`（投影、展开、片段标记）、`session-search.test.ts`（基于真实 Trace 文件的端到端：匹配、过滤、拒绝、增量索引、删除、仅标题命中）。
