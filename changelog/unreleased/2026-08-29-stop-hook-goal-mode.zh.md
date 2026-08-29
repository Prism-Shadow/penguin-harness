# Stop hook 取代 goal 循环，第二个 hook 把长会话的发现回流进 Skill

- **Date:** 2026-08-29
- **Type:** feature
- **Scope:** `core`, `server`, `web`, `cli`, `docs`
- **Breaking:** yes

[English](2026-08-29-stop-hook-goal-mode.md)

Session 新增了 hook 机制——在 agent loop 的固定点上执行的函数，目前只有一个点：**stop**，即一个 Task 结束的那一刻。目标模式以 ralph loop 的形态重建为其中一个 hook：目标文件就是状态，hook 在每个 Task 结束后读它，要么注入下一轮，要么结束目标。专属的 goal 循环与它的 `goal_finished` 消息都不在了；hook 的回答以通用的 `hook` 事件记录。第二个内置 hook 挂在同一个点上，把长会话的发现交给一个后台子 Session 沉淀进 Agent 的 Skill。

## Stop hook

- `SessionConfig.hooks.stop` 接收一组具名 hook。一次 `run` 调用的每个 Task 结束后，每个 hook 都拿到：正在写入的 Trace 文件、Task 的结束方式（`completed` / `aborted` / `fatal`）、本次运行的 Task 数与非缓存 token 花费（含子 Session）、Session 累计轮次，以及本次运行的审批回调。
- hook 回答 `continue`（附下一个 Task 的 user 文本 `input`）、`stop`，或什么都不答。每个回答都成为一条 `hook` 事件消息——`hook`、`name`、`decision`、`reason` 与 hook 自己的标量 `output`——推到流上并写入 Trace；注入的输入不在事件里，它是紧随其后的那条 user 消息。第一个 `continue` 在同一次 `run` 调用内驱动下一个 Task；被掐断之后、或 signal 已中止时，`continue` 只记录、不执行。hook 抛错以错误信息为 reason 记录，拖不垮运行。
- Trace 页把 `hook` 事件渲染为名称、决定、说明与记录；CLI 为每个 hook 回答打印一行暗色文字（goal hook 除外——它自己的轮次行与摘要行已经说明了决定）。

## 作为 hook 的目标模式

- `session.run(input, { goal: { budget } })` 写下 `GOAL.yaml`，yield 并运行第一轮 `[goal]` 消息，再把 goal hook 排在这次运行 stop hook 的最前面。文件现在承载全部状态——`objective`、`status`、`budget`、`round`、`tokens_used`——由 hook 每轮重写；模型仍只拥有 `status`（`complete` / `blocked`），`objective` / `budget` 每次写回时都以 hook 自己的副本重申。`[goal]` 块内嵌这份文件（含数字），取代原先单独的预算行。
- 判定顺序：模型的裁决优先；被掐断的 Task 以 `aborted` 结束目标；收尾轮以 `budget_limited` 结束；100 轮是失控兜底；预算到达换来一轮收尾轮；否则进入下一轮。终态同样写进文件，文件与最后一条事件永远一致。文件损坏时目标以 `blocked` 停下、文件保持原样。
- 宿主从 hook 的 `stop` 事件读结局：`goalOutcomeOf` 取代 `goalFinishedOf`，`goalProgressOf` 读每一条 goal hook 事件，`isGoalRoundInput` 不变。`GoalRunOptions.maxRounds` 移除（兜底是常量，从不是宿主旋钮）。
- Web 服务端不再有目标表：`GET /api/sessions/:id/goal` 直接读该 Session 的 `GOAL.yaml`，Session 未运行而文件仍 active 时读作 `aborted`——目标只在它的运行跨度内活着，启动时的孤儿回收随表一起移除。`goal_started` / `goal_round` / `goal_finished` 服务端事件与聊天页 banner 不变；`goal_round` 的 `used` 现在取自 hook 的记录，而非第二套计数。

## skill_summary hook

- 由 `system_config.yaml` 的 `hooks.skill_summary` 配置——`enabled`（缺省 true）与 `min_turns`（缺省 20）——只注册在顶层 Session 上。Session 累计运行满 `min_turns` 个 LLM 轮次后，hook 在每个 Task 结束时读当前 Trace 文件，取上一条它记下的摘要事件之后的记录，当该窗口累积 `min_turns` 个完成的轮次时触发。Trace 就是它唯一的状态：重启不影响，压缩换文件则从新文件重新计窗。
- 它把窗口浓缩成摘录——user 与 assistant 文本、工具调用与参数、工具输出，各自截断，超过 6 万字符时丢弃最早的行，不含思考与图片——再经 subagent runner 派生同一 Agent 的一个后台子 Session（不占 `run_subagent` 的槽位、不进面板、不回报完成通知；子 Session 有自己的 Trace，并继承本次运行的审批回调）。prompt 给出 Skill 目录与窗口内调用过的 Skill 名，请子 Session 把值得沉淀的发现写进相关 `SKILL.md` 并 bump 版本，或什么都不改。hook 在自己的 `hook` 事件里记下子 Session id 与窗口轮数。没有安装任何 Skill 的 Agent 不会触发。

## 兼容性

- **`goal_finished` 不复存在**：`GoalFinishedPayload` 类型、`goalFinished` 构造器与 `goalFinishedOf` / `goalTokenDelta` 均已移除。消费方改用 `goalOutcomeOf` 读 goal hook 的 `hook` 事件（`name: goal`、`decision: stop`）；运行的计数规则是 `uncachedTokens`。早期版本写下的 Trace 仍带 `goal_finished` 记录；按 payload 类型分支的读取方把它当作未知事件（Trace 页显示该行但没有摘要）。
- **`GOAL.yaml` 换了形状**：`budget`、`round`、`tokens_used` 加入 `objective` 与 `status`，系统侧的结局写进 `status`。早期版本留下的文件按宽容规则读取（缺失的计数读作零），只影响 `GET /goal`——Session 未运行时报 `aborted`。
- **`goal_state` 表不再创建、写入或读取。** 既有 `web.db` 里的行原样保留；没有任何东西依赖它们，可手工删表。
- **skill_summary hook 缺省开启**，既有 Agent 亦然——`system_config.yaml` 早于 `hooks` 节的 Agent 按缺省值运行它。每次触发花费一次后台子 Session 对会话摘录的运行；设 `hooks.skill_summary.enabled: false` 关闭，或调高 `min_turns`。
