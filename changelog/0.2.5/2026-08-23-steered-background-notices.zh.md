# 后台完成回报以 steering 注入运行中任务

- **Date:** 2026-08-23
- **Type:** feature
- **Scope:** `core`, `server`, `web`
- **PR:** [#407](https://github.com/Prism-Shadow/penguin-harness/pull/407)

[English](2026-08-23-steered-background-notices.md)

规范了 `run_in_background` 完成回报进入对话的方式。前台 agent loop 运行中时,回报在下一次输入组装边界注入——与运行中 steering 同一机制——并且这一事实现在落在线上:`[background_task_done]` 块携带 `delivery: steering` 字段行,于投递时打上。会话空闲时投递的回报仍是新任务自己的起始输入,不带该标记。两种投递在轨迹里位置同构(都落在 `request_end` 与下一个 `request_begin` 之间),因此各渲染层与统计层区分「同一轮之内」与「独立一轮」的依据就是这枚落盘标记。

## 细节

- core 的 Session 改为排队原始完成事件,由消费端构建 harness user 消息:引擎的运行中排空打上 `delivery: steering`,宿主的空闲取走不带该字段。`parseBackgroundTaskDoneMessage` 读回该字段,共享判定 `isSteeredBackgroundNotice` 供各处轮次切分实现取用。
- 四处「什么是一轮」的实现一致把 steered 回报按 steering 对待——留在当前轮之内、绝不开新轮:聊天流 reducer 给它专属的 `background_notice` 条目(仍渲染为同款可折叠完成横幅,只是随流内嵌),对话索引不为它开条目,服务端窗口扫描器在它处既不切窗口也不计轮(`CACHE_VERSION` 升至 2——缓存的分页统计首次读取时重算),轨迹分析把续起的请求并入当前轮、注入消息的时间戳不参与该轮用时。会话 fork 的切点判定同样豁免。
- 逐轮统计行不再在注入点于任务中途出现:仍然只出现一次,在整个任务结束时。steered 回报使任务越过收尾压缩继续时,为续段开出自己的一轮,与 steering 插话完全同规。
- 运行起点排空的回报跟在新 Prompt 之后、属于该 Prompt 的一轮:注入只在两次请求之间的空档投递时才强制续轮,因此搭车投递的回报不再把新轮并进上一轮。同一规则下,紧随任务中途压缩完成之后投递的 steering 插话或 steered 回报,在轨迹分析中也改为开出续段自己的一轮,不再被并入压缩轮。
- 空闲投递的回报保持既有口径——在所有观测面独立一轮。其对话索引条目现在以可读的回报正文为题,不再是原始标记块;完成回报(两种投递)也不再进入输入区的输入历史:它们是 harness 写就的,不是用户键入的内容。
- 存量轨迹(打标之前记录)获得位置兜底:未打标的回报若落在本轮已配对工具输出与续起 Request 之间,凭位置即可证明在任务中——Task 不可能在这个空档结束——聊天 reducer、窗口扫描器与轨迹分析统一按注入处理,四处轮次实现对旧数据保持一致。无工具收尾之后的未打标回报保持独立一轮(那里空闲投递真实可能,只有新 core 写下的标记能区分两者)。新增字段行会被旧解析器忽略。
