# 定时任务默认投递到当前 Session

- **Date:** 2026-08-26
- **Type:** feature
- **Scope:** `core`, `skills`
- **PR:** [#498](https://github.com/Prism-Shadow/penguin-harness/pull/498)

[English](2026-08-26-schedule-target-current-session.md)

内置的 Schedules Prompt 现在会让 Agent 把定时任务指向它当前所在的 Session——`session_id` 取自 Environment 小节的 Session ID 那一行——于是在对话中安排的任务会回到这段对话里，而不是落进一个无人查看的新 Session。每次触发新开 Session 成为需要时才选的另一种形态：用户明确要求单独的 Session、该任务本就应当从干净的上下文开始，或者它需要活得比这段对话更久。

## 细节

- `# Scheduled Tasks` 的字段规则现在先讲 `session_id` 及其默认取值，再讲新开 Session 的形态；围栏示例中一并写出 `session_id` 与 `end_at`。`session_id` 仍不能与 `workspace` / `provider` / `model_id` 同时出现；未写 `session_id` 的文件仍是每次触发新开一个 Session——TOML 格式本身没有变化。
- 同一段规则也点明了哪些场景不该指向当前 Session。Session 并不是一段对话的持久身份——切换模型或切换 Agent 都会新开一个，删除对话则会让绑定其上的任务失去投递目标——因此需要活得比这段对话更久的任务，改用新开 Session 的形态。子智能体渲染到的是同一段说明，而它自己的 Session 转瞬即逝，因此除非调用方给了 id，否则它不写 `session_id`。
- 新增一条卫生规则，约束这个默认所带来的常见形态：指向自身 Session 的周期任务，每次触发都会让该 Session 的上下文继续增长，因此在请求本身有自然终点时要写 `end_at`、一次性提醒用一次性任务、单次触发的工作量保持小。用户要的是无限期的提醒时则不写 `end_at`：Agent 会在回复里说明该任务将一直运行到用户删除为止，而不是替它编一个到期时间、让提醒到那天悄悄停掉。
- `penguin-orchestration` 技能中 `penguin schedule add` 的说明采用同一默认（`--session-id "$PENGUIN_SESSION_ID"`），其「避免失控循环」的警示也在同一条件下点明了终止这类任务所需的约束。

## 既有 Agent

配置内核版本前进到 `2026-08-26`，「定时任务」设置页随之变动。磁盘上已存在的 Agent 保留自己的 `schedules.prompt`，继续按旧说明运行，直到其所有者在 Agent 设置页执行更新内核；届时仍等于上一代内置默认的「定时任务」页会被整页重写，而被改动过的页面则整页保留。
