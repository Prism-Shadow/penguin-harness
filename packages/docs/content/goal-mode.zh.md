---
title: 目标模式
description: 给 Agent 一个目标而不是一条消息——一个 stop hook 在同一 Session 上持续驱动 Task，直到目标完成、受阻或 token 预算耗尽。
---

## 是什么

普通 Task 在模型不再调用工具、给出回复时就结束了。目标模式反转了这个契约：你给出一个**目标（objective）**，系统在同一个 Session 上持续驱动 Task——每一轮重新注入目标并检查控制文件——直到目标进入终态。模型不能靠"不说话"来停下：它必须通过下述协议**声明**完成（或真正的僵局），否则循环继续。

底层实现上，目标模式就是一个 [stop hook](/agent-loop#stop-hook)：Task 结束时，goal hook 读控制文件，回答 `continue`（以下一轮的 `[goal]` 消息为输入）或 `stop`。没有专属的循环，也没有专属的消息类型——目标的结局就是这个 hook 的 `stop` 事件。

三个入口都能发起目标：

| 入口 | 用法 |
| --- | --- |
| Web App | 输入框的 `+` 菜单 →「目标模式」（或输入 `/goal`）；chip 上可填 token 预算（`500k`、`2m`，留空不限）。输入框选中的技能以 `[use_skills]` 块前缀在第一轮消息上，与普通发送完全一致 |
| CLI chat | `/goal[:<预算>] <目标>`，例如 `/goal:500k 让所有测试通过` |
| CLI 单次运行 | `penguin run --goal [预算] -m "<目标>"`；仅目标完成时退出码为 0 |
| Server API | `POST /api/sessions/:id/tasks`，body 带 `{ input, goal: { budget } }`（budget 为 `-1` 或缺省 = 不限额） |

在 SDK 中，目标模式是唯一入口 `run` 的一个选项——`session.run(input, { goal: { budget } })`——而不是独立 API：输入文本即目标，文件写下，第一轮消息 yield 出来并运行，goal hook 排在这次调用 stop hook 的最前面；之后每一轮都是它的 `continue`。宿主用 `goalOutcomeOf` 从 hook 的 `stop` 事件读结局，用 `isGoalRoundInput` 识别轮边界。

## 状态文件：GOAL.yaml

目标的状态是一个文件，位于 `<agent_dir>/scratchpad/<session_id>/GOAL.yaml`（与模型的 `PLAN.md` 约定同级），目标启动时创建，此后每轮结束由 goal hook 重写：

```yaml
objective: 让所有测试通过
status: active
budget: 500000
round: 3
tokens_used: 123456
```

| 字段 | 写入方 | 说明 |
| --- | --- | --- |
| `objective` | 系统，创建时 | hook 自己保存一份、每轮写回，改动文件里的值不影响任何行为 |
| `status` | 模型或系统 | `complete` / `blocked` 是模型的——它回传循环的唯一信箱，也是它唯一可以改的字段；`active`、`wrapping_up`（预算耗尽后的收尾轮）、`budget_limited`、`aborted` 是系统的 |
| `budget` | 系统，创建时 | 整个目标的 token 预算；`-1` = 不设 |
| `round` | 系统，每轮 | 进行中的轮次；到终态时即已运行的轮数 |
| `tokens_used` | 系统，每轮 | 迄今消耗的非缓存 input + output，含子 Session |

文件永远是目标的当前状态——Web 服务端直接从它恢复聊天页的 banner。读取是容错的：文件缺失或 YAML 解析失败时目标以 `blocked` 停下、文件保持原样；协议外的 status 同样读作 `blocked`——控制通道坏了就停下循环，而不是无限空转。

## 循环

每一轮的 user 消息是一个 `[goal]` 协议块加纯文本正文——第一轮原样携带你的原始消息（含技能调用块等前缀）；后续轮重新注入目标文本。Web App 把协议块折叠为普通用户气泡下方的「目标 · 第 N 轮」提示；Trace 中原样保留。协议块内嵌 hook 刚写下的那份 `GOAL.yaml`（轮次、已用 token、预算都在其中，模型看到的就是它要编辑的那个文件），并附工作规则——声明完成前必须基于证据逐项核验、不许把目标缩水成更容易的子集、关键进展写入 `PLAN.md` 以跨越上下文压缩。Task 结束后 goal hook 按序判定，第一条命中即生效：

- 文件写着 `complete` → 目标完成；`blocked` → 模型缺什么写在它最后一条回复里。注入规则要求**同一阻塞条件持续三个连续轮次**后才允许声明 `blocked`，临时性障碍不会终结目标；
- 这一轮被掐断（用户停止、LLM 故障、单 Task 轮次上限 `max_turns`）→ `aborted`：模型没来得及写文件，重发只会撞上同一次掐断；
- 收尾轮刚跑完 → `budget_limited`；
- 满 100 轮 → `aborted`（未设或预算极大、而模型从不写文件时的失控兜底）；
- 预算已到 → 一轮收尾轮；
- 否则 → 下一轮。

每个回答都以一条 `hook` 事件（`name: goal`）记在流与 Trace 里，`output` 携带文件的状态——`status`、`round`、`tokens_used`、`budget`。终态同样写进文件，文件与最后一条事件永远一致。

### 目标里的图片

目标可以附带图片——「把页面改成这张设计稿的样子」本身就是一个目标，而一张截图比一段描述说得清楚。图片一律写入会话 scratchpad，在目标文本里以 `[attached image: <路径>]` 行引用，**与模型是否支持视觉无关**：目标每轮都作为协议块的文本被重新注入，图片没法以图片的形态跟着走。只在第一轮发，后续每一轮的目标就指向了一个早已被压缩掉的东西，而目标文本读起来却毫无破绽。作为路径，它跨越每一轮、每一次压缩都稳定存在，而模型只在真的要看的时候才付出 token（有视觉用 `read_image`，没有则 `describe_image`）。图片不能替代文字——一张图说明不了目标，所以没有文字的目标输入会被拒绝。

聊天页在第一轮气泡下方完整展示附图，后续轮次收成一行 chip（点击展开）：它确实在每一轮的输入里，但二十轮的目标不该把同一张图重复二十次。

Web App 中常规停止按钮即中止整个目标；CLI 中是 Ctrl-C。用户的中断压过 hook：被掐断之后任何 `continue` 都不会执行，目标以 `aborted` 结束，文件也如此记录。

## Token 预算

计数就是这次运行自己的账：**非缓存 input + output**（`request.total − cache_read`），对每一轮的每个请求累加，*包括 `run_subagent` 派生的子 Session*。`tokens_used` 从 0 开始。这个累加值是**花费的估算而非账单**：缓存读取并非免费，只是单价远低于非缓存 input，忽略它既不失真，也免去了依赖各模型价目表。

预算在轮与轮之间检查。耗尽时不会把模型拦腰斩断：系统注入最后一个收尾轮——总结进展、列出剩余工作、给出明确的下一步，并且不许因为钱花完了就标 `complete`——之后 hook 以 `budget_limited` 终局（收尾轮里如实写下的 `complete` 仍然算数）。正因为只在轮间检查，进行中的一轮不会被截断：实际花费最多可超出预算一轮，外加收尾轮。未设预算时循环一直跑到 `complete` 或 `blocked`——边界是模型对两个终态的诚实，外加 100 轮的硬性兜底上限。

## 服务端状态与事件

Web 服务端不再有目标表：`GET /api/sessions/:id/goal` 直接读该 Session 的 `GOAL.yaml`（从未运行过目标时为 null）。目标只在它的运行跨度内活着，所以 Session 并未运行而文件仍是 `active`（或处于收尾轮）时，那是崩溃或被杀留下的，读作 `aborted`。实时进度通过会话 SSE 通道的 `goal_started` / `goal_round` / `goal_finished` 事件到达，由流上的轮输入与 goal hook 事件映射而来。删除 Session 会连同 scratchpad（包括 `GOAL.yaml`）一起清除。
