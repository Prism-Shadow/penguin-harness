# 会话来源一律记录在案，侧栏把所有后台会话收进一个折叠夹

- **Date:** 2026-10-07
- **Type:** feature
- **Scope:** `core`, `server`, `web`, `cli`, `docs`
- **PR:** [#999](https://github.com/Prism-Shadow/penguin-harness/pull/999)

[English](2026-10-07-session-source.md)

每个 Session 的 `session_meta` 都以必填的 `source` 记录它是哪一类会话：`user` 是人发起的对话，`schedule` 是定时任务的一次运行，`subagent` 是 `run_subagent` 派生的子会话，`cli` 是 `penguin run` 创建的会话，`company` 是公司模式的工位与工单会话，`api` 留给 Agent API 开出的会话。`benchmark` 已停用。侧栏的子智能体、定时任务、评估任务三个折叠夹合并为一个**后台会话**折叠夹，收纳由程序开出的 Session，每行标出来源；公司模式的会话完全不出现在会话列表中。此前写下的 Trace 如何读取，记在[向后兼容](2026-10-07-backward-compatibility.zh.md)中。

## 细节

- `createSession` 未给来源时，core 记录 `source: "user"`；恢复的 Session 把来源带进它开启的每个上下文。`SessionSource` 只在 core 的 OmniMessage 类型中定义一次，`normalizeSessionSource` 负责收窄从 Trace 或转发的 meta 中读回的值。
- Web App 输入框发起的对话、分叉出的会话和 `penguin chat` 都是 `user`；服务器的 `client` 列（创建该行的程序）仍是另一条信息。分叉会话的 Trace 开头一律记录 `user`，不论它从哪类会话分出。
- 公司模式的组织运行时以 `company` 开出工位会话与工单会话，仍标 `client: "org"`；它们派生的子会话仍是 `subagent`。招聘时开出、服务器重启前还没运行过的工位会话，首次运行时按 `company` 重建；在此之前，列表也把这样的行读作 `company`。
- `penguin run` 创建的每个 Session 都是 `cli`，包括 agent-evaluation Skill 启动的被测会话；该 Skill 不再传 `--source benchmark`，这个参数也从帮助中移除。
- 会话列表与 Agent Trace 列表的 `category` 改为 `active`、`background`、`archived` 三种，`counts=1` 返回这三项总数：已归档优先，其余的 `user` 会话或尚未分类的行为 `active`，`api`、`schedule`、`subagent`、`cli` 为 `background`。`company` 会话不属于任何类别，归档与否都一样：按类别、按 Workspace 分组或带总数请求的列表，把它移出这一页、各项总数、按 Workspace 的总数及其时间戳，分页的 Agent Trace 列表同样不含它；不带这些参数的完整列表仍会返回它，公司模式自己的会话接口照旧列出工位与工单。`excludeOrg` 保留，因为它还会剔除公司模式会话派生的子会话，以及组织文件已列出、但下一轮扫描尚未打上标记的行。创建时 `source` 只接受 `"cli"`，`api`、`schedule`、`subagent`、`company`、`user` 均返回 400。`session_created` 一律带上新 Session 的来源。
- Web App 侧栏在每个分组的活跃对话下方显示一个后台会话折叠夹（按时间分组时整个 Project 共用一组），与其他折叠夹一样按 Agent 与类别加载、分页。其中每行带一个来源图标与悬停提示：插头表示 API，日历表示定时任务，两个机器人表示子智能体，`>_` 提示符表示 CLI。闹钟仍只标记绑定了待触发定时任务的对话。
- **最近一次对话**、对话页的自动选中，以及删除当前对话后的跳转，都只选人发起的对话，定时任务的运行不再计入，公司模式的会话也从不计入。
- 评估中心的**使用**对话框不再标记它组装的对话：评估会话是一段普通对话，草稿缓存也不再保存这个标记。这取代了[「评估任务」子夹只收 Agent 启动的被测会话](2026-10-04-evaluation-tasks-list.zh.md)的规则：那条规则为被测会话保留 `benchmark`，现在它们是「后台会话」子夹里的 `cli` 会话。
- 画廊的模拟列表接口与示例数据改用这三种类别，其中公司模式的工位会话示例改为不属于任何类别的 `company` 会话。
