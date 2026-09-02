---
title: 目标模式
description: 给 Agent 一个目标而不是一条消息——goal 插件的 stop hook 在同一 Session 上持续驱动 Task，直到目标完成、受阻或 token 预算耗尽。
---

## 是什么

普通 Task 在模型不再调用工具、给出回复时就结束了。目标模式反转了这个契约：你给出一个**目标（objective）**，系统在同一个 Session 上持续驱动 Task——每一轮重新注入目标并检查目标文件——直到目标进入终态。模型不能靠"不说话"来停下：它必须通过下述协议**声明**完成（或真正的僵局），否则循环继续。

目标模式就是 **`goal` 插件**，一个[钩子包](/skills#钩子包)，`default_agent` 预装，任何 Agent 都可以从插件库安装。它的 `start.mjs`——钩子包的 [`user_prompt` hook](/agent-loop#user-prompt-hook)——写下目标文件、以第一轮协议消息作为扩展 `context` 应答提交的 Prompt；它的 `stop.mjs`——一个 [stop hook](/agent-loop#stop-hook)——在每个 Task 结束后读 Session 的 Trace，回答 `continue`（附下一轮的消息）或 `stop`。核心 SDK 不知道目标是什么；咨询钩子的循环是通用的。没装插件的 Agent 发不起目标：Web App 与 API 会直说（`409 goal_plugin_not_installed`），而不是跑一个到点就结束的普通 Task。

三个入口都能发起目标：

| 入口 | 用法 |
| --- | --- |
| Web App | 输入框的 `+` 菜单 →「目标模式」（或输入 `/goal`）；chip 上可填 token 预算（`500k`、`2m`，留空不限）。输入框选中的技能以 `[use_skills]` 块前缀在第一轮消息上，与普通发送完全一致 |
| CLI chat | `/goal[:<预算>] <目标>`，例如 `/goal:500k 让所有测试通过` |
| CLI 单次运行 | `penguin run --goal [预算] -m "<目标>"`；仅目标完成时退出码为 0 |
| Server API | `POST /api/sessions/:id/tasks`，body 带 `{ input, goal: { budget } }`（budget 为 `-1` 或缺省 = 不限额） |

底层上，服务端请 Session 运行 goal 包的 `user_prompt` hook——已安装的 `agent_state/hooks/goal/start.mjs`，stdin 收到 `{ hook: "user_prompt", session_id, scratchpad_dir, prompt, budget }`——再以你原样的消息、紧随其后它打印的 `{ context }`（标记 `sender: "harness"`）发起目标运行；之后由 stop hook 接手。因此在 SDK 里，目标就是装了插件的 Agent 上一次普通的 `session.run`，以同样的方式写下目标文件（`Session.runUserPromptHook("goal", …)`，或直接调用脚本）来发起。

## 目标文件：GOAL.json

目标的状态是一个文件，位于 `<agent_dir>/scratchpad/<session_id>/GOAL.json`（与模型的 `PLAN.md` 约定同级），目标启动时创建，此后每轮结束由 stop hook 重写：

```json
{
  "objective": "让所有测试通过",
  "status": "active",
  "budget": 500000,
  "round": 3,
  "tokens_used": 123456
}
```

| 字段 | 写入方 | 说明 |
| --- | --- | --- |
| `objective` | 启动脚本 | 后续每轮重新注入的文本 |
| `status` | 模型或钩子 | `complete` / `blocked` 是模型的——它回传循环的唯一信箱，也是它唯一可以改的字段；`active`、`wrapping_up`（预算耗尽后的收尾轮）、`budget_limited`、`aborted` 是钩子的 |
| `budget` | 启动脚本 | 整个目标的 token 预算；`-1` = 不设 |
| `round` | 钩子，每轮 | 进行中的轮次；到终态时即已运行的轮数 |
| `tokens_used` | 钩子，每轮 | 主会话迄今消耗的非缓存 input + output，从 Trace 读出 |
| `ended` | 钩子，结束时 | 钩子对终态动过手之后置 `true`——借此区分这次运行刚结束的目标与早先某次运行结束的目标（后者钩子保持沉默） |

文件永远是目标的当前状态——Web 服务端直接从它恢复聊天页的 banner。读取是容错的：不再能解析的文件让目标以 `blocked` 停下并被挪到 `GOAL.json.broken`，协议外的 `status` 读作 `blocked`——控制通道坏了就停下循环，而不是无限空转。

## 循环

每一轮的协议消息就是纯文本 user 消息，带 `sender: "harness"` 标记——没有任何标记块；来源全靠这一标记说明，Web App 把它渲染为一张紧凑的折叠卡片（「由 harness 注入」，后台任务通知同款形态），展开可见全文。第一轮先原样发送你自己的消息（文本与图片、技能调用块等一并保留），协议消息紧随其后、指回你的消息作为目标；后续轮从目标文件复述目标文本。协议消息内嵌钩子刚写下的那份 `GOAL.json`（轮次、已用 token、预算都在其中，模型看到的就是它要编辑的那个文件），并附工作规则——声明完成前必须基于证据逐项核验、不许把目标缩水成更容易的子集、关键进展写入 `PLAN.md` 以跨越上下文压缩。Task 结束后 stop hook 读 Trace 与文件、按序判定，第一条命中即生效：

- 文件写着 `complete` → 目标完成；`blocked` → 模型缺什么写在它最后一条回复里。注入规则要求**同一阻塞条件持续三个连续轮次**后才允许声明 `blocked`，临时性障碍不会终结目标；
- 这一轮被掐断——`abort` 事件（用户停止）、最后一次请求彻底失败、或单 Task `max_turns` 通知——→ `aborted`：模型没来得及写文件，重发只会撞上同一次掐断；
- 收尾轮刚跑完 → `budget_limited`；
- 满 100 轮 → `aborted`（未设或预算极大、而模型从不写文件时的失控兜底）；
- 预算已到 → 一轮收尾轮；
- 否则 → 下一轮。

每个回答都以一条 `hook` 事件（`name: goal`）记在流与 Trace 里，`output` 携带文件的状态——`status`、`round`、`tokens_used`、`budget`。终态同样写进文件，文件与最后一条事件永远一致。

### 目标里的图片

目标可以附带图片：它们作为普通输入随第一轮发出，模型当时就能看到；后续轮只重新注入目标文本。图片不能替代文字——一张图说明不了目标，所以没有文字的目标输入会被拒绝；文件附件也会被拒绝，因为没有东西能把它带过后续轮次。

Web App 中常规停止按钮即中止整个目标；CLI 中是 Ctrl-C。用户的中断压过钩子：被掐断之后任何 `continue` 都不会执行，目标以 `aborted` 结束，文件也如此记录。

## Token 预算

钩子从 Trace 上数这一轮的用量：自本轮 harness 注入的输入以来每条 `token_usage` 记录的**非缓存 input + output**（`request.total − cache_read`），累加进 `tokens_used`。子 Session 有自己的 Trace，不计入。这个累加值是**花费的估算而非账单**：缓存读取并非免费，只是单价远低于非缓存 input，忽略它既不失真，也免去了依赖各模型价目表。

预算在轮与轮之间检查。耗尽时不会把模型拦腰斩断：系统注入最后一个收尾轮——总结进展、列出剩余工作、给出明确的下一步，并且不许因为钱花完了就标 `complete`——之后钩子以 `budget_limited` 终局（收尾轮里如实写下的 `complete` 仍然算数）。正因为只在轮间检查，进行中的一轮不会被截断：实际花费最多可超出预算一轮，外加收尾轮。未设预算时循环一直跑到 `complete` 或 `blocked`——边界是模型对两个终态的诚实，外加 100 轮的硬性兜底上限。

## 服务端状态与事件

Web 服务端不再有目标表：`GET /api/sessions/:id/goal` 直接读该 Session 的 `GOAL.json`（从未运行过目标时为 null）。目标只在它的运行跨度内活着，所以 Session 并未运行而钩子尚未结束的文件，那是崩溃或被杀留下的，读作 `aborted`。实时进度通过会话 SSE 通道的 `goal_started` / `goal_round` / `goal_finished` 事件到达，由流上的轮输入与 goal hook 事件映射而来。删除 Session 会连同 scratchpad（包括 `GOAL.json`）一起清除。
