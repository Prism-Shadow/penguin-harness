---
title: 目标模式
description: 给 Agent 一个目标而不是一条消息——系统在同一 Session 上循环驱动 Task，直到目标完成、受阻或 token 预算耗尽。
---

## 是什么

普通 Task 在模型不再调用工具、给出回复时就结束了。目标模式反转了这个契约：你给出一个**目标（objective）**，系统在同一个 Session 上持续驱动 Task——每一轮重新注入目标并检查控制文件——直到目标进入终态。模型不能靠"不说话"来停下：它必须通过下述协议**声明**完成（或真正的僵局），否则循环继续。

三个入口都能发起目标：

| 入口 | 用法 |
| --- | --- |
| Web App | 输入框的 `+` 菜单 →「目标模式」（或输入 `/goal`）；chip 上可填 token 预算（`500k`、`2m`，留空不限） |
| CLI chat | `/goal[:<预算>] <目标>`，例如 `/goal:500k 让所有测试通过` |
| CLI 单次运行 | `penguin run --goal [预算] -m "<目标>"`；仅目标完成时退出码为 0 |
| Server API | `POST /api/sessions/:id/tasks`，body 带 `{ input, goal: { budget } }`（budget 为 `-1` 或缺省 = 不限额） |

## 控制文件：GOAL.yaml

循环的状态通道是一个文件，位于 `<agent_dir>/scratchpad/<session_id>/GOAL.yaml`（与模型的 `PLAN.md` 约定同级），目标启动时由系统创建：

```yaml
objective: 让所有测试通过
status: active
tokens:
  budget: 500000
  used: 120345
  remaining: 379655
```

字段所有权是硬边界，且文件**不参与执法**：

| 字段 | 写入方 | 说明 |
| --- | --- | --- |
| `objective` | 系统，仅一次 | 之后不再变更 |
| `status` | 模型 | 只允许改为 `complete` 或 `blocked`；初始 `active` 与终态 `budget_limited` 由系统写入 |
| `tokens` | 系统，每轮刷新 | 仅供模型参考——预算判断永远使用运行器内部计数器，改坏文件也解不开限额 |

读取是容错的：文件缺失、YAML 解析失败、协议外的 status 一律归一化为 `blocked`——控制通道坏了就停下循环，而不是无限空转。

## 循环

每一轮注入一条 `<goal_task>` user 消息（Web App 折叠为「目标 · 第 N 轮」一行提示；Trace 中原样保留），内容包括目标、当前预算数字和工作规则——声明完成前必须基于证据逐项核验、不许把目标缩水成更容易的子集、关键进展写入 `PLAN.md` 以跨越上下文压缩。Task 结束后系统读取 `status`：

- `complete` → 目标完成，循环停止。
- `blocked` → 循环停止；模型缺什么写在它最后一条回复里。注入规则要求**同一阻塞条件持续三个连续轮次**后才允许声明 `blocked`，临时性障碍不会终结目标。
- `active` → 预算允许则进入下一轮。

某一轮以中断结束（用户停止、LLM 故障）时整个目标随之结束、不再续推——磁盘上的状态保持 `active`，工作区与目标文件就是干净的断点。Web App 中常规停止按钮即中止整个循环；CLI 中是 Ctrl-C。

## Token 预算

计数是增量制——**非缓存 input + output**（`request.total − cache_read`），对每一轮的每个请求累加，*包括 `run_subagent` 派生的子 Session*。`used` 从 0 开始；缓存命中不计费。

预算在轮与轮之间检查。耗尽时不会把模型拦腰斩断：系统注入最后一个收尾轮——总结进展、列出剩余工作、给出明确的下一步，并且不许因为钱花完了就标 `complete`——之后系统写入 `budget_limited` 并停止。未设预算时循环一直跑到 `complete` 或 `blocked`；没有轮数上限，无预算目标的边界只剩模型对两个终态的诚实。

## 服务端状态与事件

Web 服务端把每次目标运行记入 `goal_state` 表（objective、status、budget、used、rounds）——聊天页的目标 banner 加载时从最新一行恢复，实时进度通过会话 SSE 通道的 `goal_started` / `goal_round` / `goal_finished` 事件到达。表中的终态 `aborted` 仅存在于服务端；磁盘文件保持 `active` 以便续跑。删除 Session 会连同 scratchpad（包括 `GOAL.yaml`）一起清除其目标记录。
