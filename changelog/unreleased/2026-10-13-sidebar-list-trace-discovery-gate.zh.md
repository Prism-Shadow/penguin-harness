# 侧栏列表不再为从未运行过的会话整树遍历 Trace

- **Date:** 2026-10-13
- **Type:** fix
- **Scope:** `server`
- **PR:** [#1106](https://github.com/Prism-Shadow/penguin-harness/pull/1106)

[English](2026-10-13-sidebar-list-trace-discovery-gate.md)

发现逻辑对每一行只问一个问题：这个会话是否写了索引尚未打标的 Trace 文件？答案原先来自对 Agent 整棵 Trace 树的 reconcile 遍历，且就在请求路径上同步执行——而在真实安装上，决定要不要跑它的那道闸每个列表请求都是开着的。

## 闸为什么一直开着

先后用过两个条件，在一个用过一段时间的安装上，两个都收不了口：

- **「该行不在进程内的 origins 注册表里」** 对进程启动前创建的每个会话都成立——也就是整个侧栏，永远成立——于是每个列表请求都要付一次 reconcile。
- **「该行仍是 `has_trace = 0`」** 会被「在界面上创建却从未发送」的会话永久保持为真：磁盘上没有任何东西可供发现与打标，这个标记永远不会翻转。在测量所用的安装上，4117 行里有 79 行如此。

而且这趟遍历并不便宜。只要 Trace 树还在被写入，Trace 索引的 mtime 闸就永远收不了口——最新的日期目录总比新鲜度窗口更新，其缓存 mtime 因此永远匹配不上——`reconcileAgent` 于是退化为对每个日期目录做一次全量 re-diff：数千个分片，每个分片在 AUTOCOMMIT 下对着 `synchronous = FULL` 的 WAL 库 upsert，一行一次 fsync（在该主机上实测：每 100 次 upsert，AUTOCOMMIT 579 ms，事务内 4 ms）。每次侧栏加载就是几秒的同步工作，而且跑在服务应答所有路由的事件循环上——一次普通的列表加载表现为 **125 秒的 `sessions/batch`**。

## 现在的答案

- **一次只读扫描。** 分片文件名为 `<sessionId>_<NNN>.jsonl`，位于 `yyyy-mm-dd` 目录之下，因此列出各日期目录就能一次性回答该请求的每一行——不做 stat、不 upsert、不 fsync。并发询问同一个 Agent 的调用方共用一次扫描。
- **磁盘上什么都没有的会话会被记住**（记忆有上限），因此不会被反复探测；之后长出 Trace 的会话由写入路径打标，这正是无需靠反复探测来发现它的原因。
- **权威 reconcile 仍会对每个新发现的会话跑一次**——注册分片并头读其事实（来源、工作区、标题、模型引用）的那条代码路径，正是 `sourceOf` 分类该行所需要的，因此发现逻辑把找到的会话交给它，而不是自己分类。

## 细节

- 新增 `SessionService.probeSessionsOnDisk` / `doProbeSessionsOnDisk`、`tracelessMemo` 与 `probesInFlight`；`walkRows` 改为询问它们而不是 `discoverTraces`，并发布打标后的视图，使读取 `traces` 的调用方在该次应答内仍是权威。
- `packages/server/test/session-list-gate.test.ts` 钉住两半：一次扫描会给磁盘上有分片的会话打标并交给 reconcile；第二次请求完全不读目录；Trace 树尚不存在的 Agent 也能正常作答而不报错。
