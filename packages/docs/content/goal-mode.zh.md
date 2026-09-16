---
title: 目标模式
description: 给 Agent 一个目标，让它持续工作，直到目标完成、受阻或 Token 预算用完。
---

在目标模式下，你交给 Agent 的是一个目标，而不是单独一条消息。harness 会在同一个 Session 上一轮接一轮地运行 Task，直到目标完成、受阻或 Token 预算用完。模型不能靠回复一句话就结束目标，必须按[目标如何运行](#目标如何运行)中的协议声明完成，或者声明确实陷入了僵局。

- 从 Web App、CLI 或 API 启动目标，见[启动目标](#启动目标)。
- 每一轮发生了什么、目标如何结束，见[目标如何运行](#目标如何运行)。
- 限制目标的花费，见 [Token 预算](#token-预算)。
- 提前结束目标，见[停止目标](#停止目标)。
- 通过 API 读取目标进度，见[查看目标状态](#查看目标状态)。

## 启动目标

**开始之前**

- Agent 已安装 `goal` 插件。`default_agent` 预装了它，其他 Agent 可以从插件库安装。
- Agent 的钩子已开启，也就是 Agent **钩子**标签页上的**启用钩子**。除非 Project owner 把它关掉，钩子默认开启。

没装插件或关了钩子，Agent 就无法启动目标。Web App 和 API 会直接返回 `409 goal_plugin_not_installed`，而不是运行一个到头就结束的普通 Task。

### 在 Web App 中

1. 在输入框中打开 `+` 菜单，选择**目标模式**；也可以直接输入 `/goal`。
2. 可选：点击目标模式标签上的预算（默认显示**预算不限**），在 **Token 预算**中填入 `500k`、`2m` 这样的值，然后点击**保存预算**。留空表示不限预算。
3. 在输入框里写下目标，然后发送。

输入框中选中的 Skill 会以 `[use_skills]` 块的形式加在第 1 轮消息的开头，和普通发送完全一样。目标运行期间，输入框上方有一条横幅，显示目标、当前轮次、已用 Token 与预算，以及目标状态。

### 在 CLI 对话中

在 `penguin chat` 中输入：

```
/goal[:<budget>] <objective>
```

例如：

```
/goal:500k make all tests pass
```

### 用单次运行

```
penguin run --goal [budget] -m "<objective>"
```

只有目标完成时，命令的退出码才是 0。

### 通过 Server API

发送 `POST /api/sessions/:id/tasks`，请求体为 `{ input, goal: { budget } }`。省略 `budget` 或设为 `-1`，表示不限预算。

## 目标文件

目标的状态保存在 `<agent_dir>/scratchpad/<session_id>/GOAL.json` 文件里，和模型的 `PLAN.md` 放在同一个目录。目标启动时创建这个文件，之后每一轮结束，stop 钩子都会重写它。

```json
{
  "objective": "make all tests pass",
  "status": "active",
  "budget": 500000,
  "round": 3,
  "tokens_used": 123456
}
```

| 字段 | 写入方 | 含义 |
| --- | --- | --- |
| `objective` | 启动脚本 | 之后每一轮重新注入的文本。 |
| `status` | 模型或钩子 | `complete` 和 `blocked` 归模型写：这是模型向循环回话的唯一途径，`status` 也是它唯一能改的字段。`active`、`wrapping_up`（预算用完后的收尾轮）、`budget_limited` 和 `aborted` 归钩子写。 |
| `budget` | 启动脚本 | 整个目标的 Token 预算。`-1` 表示不限预算。 |
| `round` | 钩子，每轮 | 正在进行的轮次。进入终态后，表示实际运行的轮数。 |
| `tokens_used` | 钩子，每轮 | 主 Session 迄今消耗的未缓存输入 Token 与输出 Token 之和，从 Trace 读出。 |
| `ended` | 钩子，结束时 | 钩子处理完终态后置为 `true`。借此区分本次运行刚结束的目标和更早某次运行已经结束的目标，钩子对后者不再作声。 |

这个文件始终反映目标的当前状态，Web 服务端直接用它恢复对话页上的目标横幅。

> [!NOTE]
> 文件坏了，目标会停下来，不会无休止地循环。文件无法解析时，目标以 `blocked` 结束，文件改名为 `GOAL.json.broken`；`status` 取了协议之外的值，也按 `blocked` 处理。

## 目标如何运行

每一轮都以一条协议消息开始。它是普通的用户文本，带 `sender: "harness"` 标记，不含任何标记块，单凭这个标记就能看出消息出自 harness。Web App 把它显示成一张标着**由 harness 注入**的紧凑折叠卡片，样式与后台通知相同，展开卡片可以看到全文。

第 1 轮先原样发送你自己的消息，其中的文字、图片和 Skill 调用块都保留。协议消息紧随其后，指明你的消息就是目标。之后的每一轮从目标文件中复述目标。

协议消息里嵌着钩子刚写好的 `GOAL.json`，轮次、已用 Token 和预算都在其中，模型看到的正是要它编辑的那份文件。消息还规定了几条工作规则：

- 声明完成之前，先拿证据核实。
- 不许把目标缩小成更容易的子集。
- 把关键进展写进 `PLAN.md`，经过上下文压缩也不会丢。

Task 结束后，stop 钩子读取 Trace 和目标文件，按下面的顺序逐条判断，命中第一条就照它处理：

1. **文件写着 `complete`。** 目标完成。
2. **文件写着 `blocked`。** 模型需要你做什么，写在它的最后一条回复里。规则要求同一个阻塞条件连续三轮都存在，模型才能声明 `blocked`，所以暂时的障碍不会让目标结束。
3. **Task 中途中断**：出现了用户停止产生的 `abort` 事件、最后一次请求最终失败，或者单个 Task 的 `max_turns` 提示。目标以 `aborted` 结束。模型没来得及写文件，再跑一轮也会遇到同样的中断。
4. **刚跑完收尾轮。** 目标以 `budget_limited` 结束。
5. **已经跑满 100 轮。** 目标以 `aborted` 结束。这是一道防失控的兜底：没设预算或预算极大的目标，如果模型始终不写文件，就会在这里停下。
6. **预算已用完。** 下一轮是收尾轮。
7. **其他情况**，开始下一轮。

### 目标里的图片

目标可以带图片。图片在第 1 轮以普通输入的形式发出，模型在那一轮就能看到。之后的轮次只重新注入目标的文字。

图片不能代替文字：光有一张图说明不了目标，所以服务端拒绝没有文字的目标输入。文件附件也不接受，因为没有机制能把它们从一轮带到下一轮。

## Token 预算

预算统计的是**未缓存输入与输出**的 Token。每一轮结束后，钩子从 Trace 读出这一轮的用量，累加到 `tokens_used`。子 Agent 的 Session 有自己的 Trace，不计入。

这个数是花费的估算，不是账单。缓存读取也收费，只是价格仅为未缓存输入的一小部分。不计入它们，得到的数仍然是合理的近似，也省去了按模型维护价目表。

预算在两轮之间检查。预算用完时，目标不会在思考到一半时戛然而止，而是再跑最后一轮收尾：模型总结进展、列出剩余工作、给出明确的下一步，并且不能只因为预算用完就声明 `complete`。之后钩子以 `budget_limited` 结束目标。收尾轮里如实写下的 `complete` 仍然有效。

> [!NOTE]
> 正在运行的一轮总会跑完，所以实际花费最多可能超出预算一轮的用量，再加上收尾轮。

不设预算时，目标会一直运行到模型声明 `complete` 或 `blocked`。这取决于模型能否如实报告这两种状态，另有 100 轮的硬性上限兜底。

## 停止目标

停止当前 Task，就会结束整个目标：

- 在 Web App 中，点击常规的停止按钮。
- 在 CLI 中，按 Ctrl-C。

你的中断优先于钩子：中断之后不会再执行任何 `continue`，目标以 `aborted` 结束，目标文件里也这样记录。

## 查看目标状态

发送 `GET /api/sessions/:id/goal`。服务端读取这个 Session 的 `GOAL.json`，返回 `{ goal: { objective, status, budget, used, rounds } }`；Session 从未运行过目标时，返回 `{ goal: null }`。

目标只存在于它的那次运行之中。如果钩子还没结束文件里的目标，Session 却已经不在运行，说明它是崩溃或进程遭强制终止时遗留下来的，读出来就是 `aborted`。

目标运行期间，实时进度以 `goal_started`、`goal_round` 和 `goal_finished` 事件，通过这个 Session 的 SSE 通道推送。

删除 Session 会一并删除它的 scratchpad，以及其中的 `GOAL.json`。

## 工作原理

### goal 插件

目标模式并不内置在核心里。`goal` 插件是一个[钩子包](/skills#钩子包)，包含两个脚本：

- `start.mjs` 是它的 [`user_prompt` 钩子](/agent-loop#user-prompt-hook)：写入目标文件，并以第 1 轮的协议消息作为扩展 `context`，应答提交的 Prompt。
- `stop.mjs` 是一个 [stop 钩子](/agent-loop#stop-hook)：每个 Task 结束后读取 Session 的 Trace，应答 `continue` 并附上下一轮的消息，或者应答 `stop`。

核心 SDK 完全不知道目标是什么，询问钩子的那个循环是通用的。

### 启动流程

服务端让 Session 运行 goal 包的 `user_prompt` 钩子，也就是已安装的 `agent_state/hooks/goal/start.mjs`，脚本从 stdin 收到 `{ hook: "user_prompt", session_id, scratchpad_dir, prompt, budget }`。随后服务端启动目标运行：先原样发送你输入的消息，再发送脚本打印的 `{ context }`，这条消息带 `sender: "harness"` 标记。之后由 stop 钩子接手。

因此在 SDK 里，目标就是装了插件的 Agent 上一次普通的 `session.run`，启动时用同样的方式写好目标文件：调用 `Session.runUserPromptHook("goal", …)`，或者直接运行脚本。

### 计数与记录

每一轮，钩子把自本轮 harness 注入的输入以来每条 `token_usage` 记录的 `request.total − cache_read` 累加起来。

stop 钩子的每次应答都记为一条 `hook` 事件（`name: goal`），出现在流里，也写进 Trace。事件的 `output` 带着文件的状态：`status`、`round`、`tokens_used` 和 `budget`。终态也会写进文件，所以文件与最后一条事件始终一致。

### 服务端状态

Web 服务端不维护目标表。目标接口直接读取 Session 的 `GOAL.json`，SSE 事件则从流中派生，来源是各轮的输入和 goal 钩子的事件。
