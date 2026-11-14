# Trace 记录每个 Task 的起止

- **Date:** 2026-10-23
- **Type:** feature
- **Scope:** `core`, `server`, `web`, `docs`
- **PR:** [#1299](https://github.com/Prism-Shadow/penguin-harness/pull/1299), [#1304](https://github.com/Prism-Shadow/penguin-harness/pull/1304)

[English](2026-10-23-trace-task-pair.md)

core 的 Session 现在在每个 Task 两侧写入一对 `task_begin` / `task_end`，既写入 Trace，也推入输出流。所有读端都接受这两条记录；对话、消息窗口与 AMSP 呈现的内容不变。此前写下的 Trace 不带它们，见[向后兼容](2026-10-23-backward-compatibility.zh.md)。

## Task 记录

- 两种 `event_msg` 载荷：`{type: "task_begin"}` 与 `{type: "task_end"}`，除类型外不带任何字段。Task 如何结束仍由这对记录之间的记录读出，由谁发起仍由输入读出。
- 每个 Task 一对：一次 Prompt 的执行，加上其后所问的 stop 钩子留下的 `hook` 记录。stop 钩子以 `continue` 续出的 Task（例如 goal 的一轮）各成一对。手动压缩与模型切换不写这对记录。
- `task_begin` 先于该 Task 写下的一切（含其输入）；`task_end` 位于 stop 钩子的 `hook` 记录之后。被中止的 Task（包括在 MCP Server 连接期间被中止的）同样以 `task_end` 收尾；抛出异常的 Task 不写。
- Session 经自己的 Trace 写入通道写这对记录，因此 Task 记录从不开启新的 Trace 文件。Task 以一次已完成的压缩收尾时，它的 `task_end` 与下一个 Task 的 `task_begin` 落在旧文件的 `compaction_end` 之后，新文件由下一个上下文的第一条消息开启。
- 恢复与服务端的上下文构成以文件中最后一条非 Task 记录判定该文件是否已被压缩收尾。在这样的 Task 之后重启，下一个上下文仍带着待发的 `[context_summary]` 开启。
- core 导出构造函数 `taskBegin`、`taskEnd`，以及读取函数 `isTaskRecord`、`isTaskBegin`、`lastNonTaskRecord`。
- 这对记录是「AMSP 不新增记录类型」规则的第二处明示例外（2026-10-22 用户决定）。

## 流上的顺序

- 服务端回显一次运行的输入，从运行开始之前改为紧跟在该运行的第一个 `task_begin` 之后，使流上一个 Task 的记录与 Trace 同序。所有发起路径都如此：Prompt、排队的后续消息、重试、定时任务、Workbench 运行、组织触发、消息软件与 goal 启动。MCP Server 连接期间，`GET /messages` 仍提供暂存的输入。
- 子 Agent 的输入在父会话流上转发时，改为跟在子会话自己的 `task_begin` 之后，与子会话的 Trace 同序。

## 读端

- 消息窗口、Web App 的对话流与大纲、CLI 渲染器以及 AMSP 翻译器忽略这对记录。窗口的切分与计数不变，AMSP 的每个事件也不变。
- Trace 分析中，`task_begin` 归入其输入开启的那一轮，Task 记录不改变任何一轮的结束时间。只以 Task 记录结尾的文件不会多出一轮。
- fork 的截断点停在下一个 Task 的 `task_begin` 之前，fork 出的 Session 因此不会以未闭合的 Task 结尾。
- Trace 视图把这两条记录列为事件行，各有图标。Gallery 的演示 Session 在每个 Task 两侧都带上了这对记录。
- AMSP 记录、Session 与 Trace、消息流与顺序、AMSP 四个文档页记录了这对记录与新的回显顺序。
