# PRFC-0015 Agent 状态组件：热更新时移交状态，运行中的 Task 不被打断

[English](PRFC-0015-agent-state.md)

> **来源**：设计仓 [penguin-harness-design](https://github.com/Prism-Shadow/penguin-harness-design) 的 `rfcs/PRFC-0015-agent-state.md`——落地于默认分支 `main`（提交 [`ac673a24`](https://github.com/Prism-Shadow/penguin-harness-design/commit/ac673a245eec78d6afca35e260dce28b2a3ab3ac)）。
> **修订**：v1.0.0（迁入主仓）；本面的约定见 [README.zh.md](README.zh.md)，逐版本改动记在文末 `## Changes`。

- Feature Name: `agent_state`
- Start Date: 2026-09-21
- PRFC PR: [Prism-Shadow/penguin-harness-design#209](https://github.com/Prism-Shadow/penguin-harness-design/pull/209)
- Implementation PR: [Prism-Shadow/penguin-harness#1059](https://github.com/Prism-Shadow/penguin-harness/pull/1059)（状态组件）、[#1060](https://github.com/Prism-Shadow/penguin-harness/pull/1060)（移交）

## Summary
[summary]: #summary

本提案落地前，热更新（hot push，以及插件变更触发的 App 重组）会 abort 所有运行中的 Task。本提案用三条措施去掉这次打断，且不改 Agent 的运行逻辑：

1. **Agent 状态组件（`AgentState`）**：Session 运行时的全部内存状态收进一个组件，组件只有数据，没有逻辑。
2. **其余组件照旧**：`SessionManager` 等现有部件的逻辑一行不改，只是改为从 `AgentState` 取状态。
3. **热更新时移交状态**：新一代平台拿到上一代的 `AgentState`。兼容则直接接手，运行中的 Task 继续；不兼容则由**旧逻辑**停掉运行中的 Task，再由**新逻辑**从文件系统状态（Trace）把它们重新跑起来。

## Motivation
[motivation]: #motivation

`hmr/platform.ts` 的 dispose effect 在每次 swap 时调用 `manager.shutdown(5s)`：待审批全部 deny、运行中的 Task 全部 abort、Session 环境 dispose。触发它的不只是 hot push——插件的启用、停用与配置变更走同一条重组路径，所以用户改一个插件设置，所有 Agent 手上的活都会断。Self-Improving 的前提是 Agent 能在工作中更新 harness；更新一次断一次，这个前提不成立。

此前有两次尝试：[#436](https://github.com/Prism-Shadow/penguin-harness/pull/436)（monitor + turn 边界 park）与 [#439](https://github.com/Prism-Shadow/penguin-harness/pull/439)（把 run loop 从引擎里反转出来，`HmrAgent` 事件循环）。两者都能工作，也都没有落地，原因相同：**改动面太大**。#439 改了 `context-engine.ts` 483 行、整体重写了 `session-manager.ts`（2108 行的 diff），Agent 的大部分代码乃至逻辑都被动过。这样的改动无法与并行开发的其他 PR 共存，也无法审阅。

当时的判断是「状态散落在各个组件里，所以必须重组逻辑」。重新清点之后，这个判断不成立——内存状态其实集中在 `SessionManager` 的六个字段里：

| 字段 | 内容 |
| --- | --- |
| `entries` | 每个已装载 Session 一条 `RuntimeEntry`：core 的 Session 对象、`status`、`approvals`、`abort`、`running`（在途 drive 的 Promise）、`followUps`、`pendingInputs` / `pendingBootstrap`、`pendingSteering` / `returnedSteering`、`backgroundTasks`、`generation`、`lastActivityMs` |
| `locks` | 每 Session 互斥链 |
| `deletingAgents` / `deletingSessions` | 删除窗口标记 |
| `agentGenerations` | Agent 配置代次 |
| `liveTail` | 在途流式片段 |

其余状态本来就不在平台这一代手里：Trace 与 `sessions` 行在磁盘上，db、channel hub、auth state 由 HMR 层持有、每代平台重新 claim。所以要移交的只有上表，而把它交出去并不需要动逻辑。

## Guide-level explanation
[guide-level-explanation]: #guide-level-explanation

把一代平台想成「逻辑」，把 `AgentState` 想成「数据」。swap 换的是逻辑，数据原样递给下一代：

```
第 N 代  SessionManager ──┐
                          ├──> AgentState（同一个对象，登记在 HMR registry 里）
第 N+1 代 SessionManager ─┘
```

swap 时每个 Session 落入三种情形之一：

- **空闲**：无事发生。下一次 Task 由新一代启动。
- **运行中，状态兼容**：新一代接手 `AgentState`。Task 不中断，状态一直读作 `running`；审批、插话（steering）、中断、排队的 follow-up 在 swap 之后都由新一代的逻辑处理，作用在同一份状态上。
- **运行中，状态不兼容**：旧一代按自己的逻辑停掉 Task（与今天的行为相同：abort 事件写入 Trace）；新一代起来后，从 Trace 把这些 Session 恢复出来并继续跑。

需要讲清的一点：**在途的 Task 跑完之前用的是旧代码。** 一个正在执行的 `drive()` 是旧一代的函数，JS 无法在执行中替换它；它持有的 core Session 对象也是旧一代的。兼容路径的含义是「不打断它」，新代码从该 Session 的下一个 Task 起生效。要让新代码在 turn 边界就生效，必须反转 run loop，那正是 #439 的代价，本提案不做（见 Future possibilities）。

## Reference-level explanation
[reference-level-explanation]: #reference-level-explanation

### `AgentState` 组件

模块树 `SessionRuntimeModule` 下新增一个节点 `AgentStateStore`，提供接口 `AgentState`：持有 Motivation 表中的六个字段，外加一个 `current` 指针（见下）。它没有方法逻辑，构造时为空。

`SessionManager` 经 deps 拿到它，并把自己的同名字段指向它的字段：

```ts
constructor(private readonly deps: SessionManagerDeps) {
  this.entries = deps.state.entries;
  this.locks = deps.state.locks;
  // …
}
```

`SessionManager` 里读写 `this.entries` 等的代码保持原样。这一步是纯重构，行为零变化，现有测试不改即通过。

### 移交

沿用终端（pty）已经在用的机制，HMR 层不需要任何改动：

- 每一代 App 在 **COMMIT**（App 完全建好之后）把 `{ state, shape, stopped? }` 登记为 registry 的 `agent:state`，登记时给出的 disposer 是**这一代自己的停止动作**，即今天的 `manager.shutdown()`。
- 平台的 dispose effect **不再调用** `manager.shutdown()`；旧一代只做 `detach()`（停掉空闲清扫定时器）。进程退出路径不变：`api.shutdown()` 与 registry 的 `disposeAll()` 仍然排空。
- 新一代判定兼容之后，把上一代的 `state` 对象作为 `AgentStateStore` 节点的现成实例交给模块树（`platformDef(…, inherited)`），新的 `SessionManager` 直接建在它之上。
- 停与不停都发生在 COMMIT：新一代 boot 失败时，内核重启上一代的 bundle，registry 里仍是上一代的登记，没有任何 Task 被停过，回滚是无损的。

### 兼容性判定

`AgentState` 是一个按**结构**进接口表的接口，不含 `Opaque`：`entries` 投影为 `{ map: [string, RuntimeEntry 的逐成员形状] }`，其中 `session` 是接口 `RuntimeSession`、`approvals` 是接口 `Approvals`，`liveTail` 是接口 `LiveTail`，两个删除窗口是 `{ set: string }`（`Map` / `Set` 的投影见 PRFC-0001「投影的边界」）。旧一代的 Session 对象会被新一代的逻辑调用，它的方法面因此也在契约之内。

判定用的是**闭包形状**（core kernel 的 `closedShape(table, key)`）：`AgentState` 的声明，连同它经接口表触及的每一个接口与具名数据类型，键排序后打印成一个字符串。每一代登记状态时一并登记自己的字符串（上文的 `shape`）；新一代把它与自己的比较，**相等**则接手，否则走不兼容路径。

用相等而非可赋值性（`satisfies`），理由有二：状态是两代都读**且**写的，单向可赋值不足以保证安全；相等的比较不需要对方的接口表，一个字符串就够。没有手写的成员清单——改了 `RuntimeEntry` 或 `RuntimeSession` 的形状，生成器重新投影，字符串自动变化。

`DECLARED_RESOURCES` 同时新增一组 `agent`，声明的是信封 `{ state, shape, stopped }` 的三个成员。它不描述状态的形状，作用是让**不声明这一组的旧平台**在回滚时按既有规则 `disposeGroup`，把运行停掉（见「分层判定」）。

### 不兼容：旧逻辑停，新逻辑重启

- `SessionsModule` 的 `park()` 返回 `{ running: string[] }`：park 时刻正在跑 Task 的 sessionId。它是 JSON，走模块树已有的 parked context（带版本与迁移）。
- 形状不等时，新一代把 `agent` 组记入 `doomedGroups`，与版本不符的组同等对待；COMMIT 阶段的 `disposeGroup` 触发旧一代登记的 disposer，即**旧逻辑**的 `shutdown()`：deny 审批、abort、dispose 环境。abort 照常写入 Trace。disposer 把 `shutdown()` 的 Promise 写回信封的 `stopped`。
- `stopped` 兑现（旧的 drive 结束，或 5 秒上限）之后，新一代对 `running` 中的每个 Session 逐个 `startTask`，输入是一条 `sender: "server"` 的 `[harness_updated]` 续跑消息。core 既有的 carry-over 会把被中断的那一 turn（`[turn_aborted]`）带回上下文，Agent 从断点接着做。
- 压缩在不兼容路径上保持今天的语义（停止，不重启）。Goal 运行在 entry 上与普通 Task 同为 `running`、无从区分，首版按普通 Task 续跑；goal 的 stop 钩子是否接着驱动后续轮次尚未验证。排队中的 follow-up 只在内存里，随旧状态一起丢弃，与今天相同。

### `current` 指针

在途的 `drive()` 属于旧一代，它结束时要做两件事：启动下一个排队的 follow-up，或投递后台完成通知。这两件事必须由**当前**一代来做，否则会用旧的 loader 装载 Session、读到 `closed` 的旧 manager。因此 `AgentState` 持有 `current`：一个只有这两个方法的 `RunStarter`（不是整个 manager——否则 manager 公共面的任何改动都会改变闭包形状），每一代构造时把它指向自己；`drive()` 收尾的这两个调用、以及登记在 Session 对象上的 `onBackgroundNotice` 监听，经 `state.current` 转发。

这是本提案对现有逻辑唯一的触碰：三处调用点由 `this.` 改为 `this.state.current?.`。

### 旧树 dispose 之后的依赖

旧一代在途的 `drive()` 与 Session 对象在旧模块树 dispose 之后仍会用到旧树的节点：`recorder`、`errors`、`titles`、`sessions`（仓储）、`channels`，以及 Session 环境的四个 getter（`proxyEnv`、`controlEnv`、`pathPrepend`、`confineSpawn`）。其中 db 与 channel hub 由 HMR 层持有，不受 dispose 影响。

规则：**这些节点在 dispose 之后必须仍可调用。** 落地时的核对结果（#1060）：上面列出的节点均无 dispose effect，`sandbox.confiner()` 亦无 dispose effect，因此无需改道。新增带 dispose effect 的节点时，若它会被在途的 run 触及，须经 `state.current` 取当前一代的对应节点。

### 分层判定

全部是平台代码。HMR 层与 runtime 不改：registry、`disposeGroup`、资源接口门、parked context 都已存在，旧的层可以直接承载。首个带 `agent` 声明的平台推到旧平台之上时，上一代没有声明这一组，也没有登记 `AgentState`，它的 dispose effect 照旧 `shutdown()`——等同今天的行为，无需兼容代码。反向回滚到不声明这一组的旧平台时，旧平台的资源接口门把 `agent` 判为「本构建不再声明的组」并 `disposeGroup`，Task 被登记的 disposer 停掉，同样等同今天的行为。

### 已合并的实现

1. **[#1059](https://github.com/Prism-Shadow/penguin-harness/pull/1059)**：`AgentState` 节点与 `SessionManager` 的字段指向；接口表新增 `{ map }` / `{ set }`，使 `AgentState` 不含 `Opaque`。无行为变化。
2. **[#1060](https://github.com/Prism-Shadow/penguin-harness/pull/1060)**：`closedShape`、移交、`current` 指针、不兼容路径的 park 与重启，以及对真实内核 `upgrade()`（经 App 重组）的集成测试：运行中的 Task 跨 swap 不中断、后继启动旧 run 收尾时交来的 follow-up；形状不同时旧 run 被停、带 `[harness_updated]` 的新 run 启动。

## Drawbacks
[drawbacks]: #drawbacks

- 一个长 Task 期间，旧一代的代码与对象一直存活；连续推送 N 次，最坏有 N 代并存，直到各自的 Task 结束。
- 新一代的逻辑操作旧一代的对象，契约由接口表的结构比较把关；比较只到签名为止，签名不变而语义变了的改动它看不出来。
  - 2026-09-22 的实例：跨推送交付的机器 ssh 会话对象（`machineSession` 组）带着上一代的 `setForwards` 实现，签名未变而行为变了（旧实现只记录、不问 ssh），资源接口门与闭包形状都看不出来，结果端口转发永远停在 `pending`。教训：**凡是交付给下一代的活对象，行为变了就要 bump 它的组名版本**（如 `machineSession.v2`）；闭包形状只能兜住形状的变化。`AgentState` 同理——改了 `RuntimeSession` 上某个方法的语义而不改签名时，须改 `agent` 组的版本。
- 机器会话也登记闭包形状（`machineSession.v2:shape`）；形状不兼容时，在 COMMIT 阶段关闭旧会话，再由新一代建立连接。成员签名之外的行为变化仍须提升组名版本。
- swap 之后到 Task 结束之前，这个 Task 的缺陷修复不生效。

## Rationale and alternatives
[rationale-and-alternatives]: #rationale-and-alternatives

- **turn 边界 park + 从 Trace 重载（#436）**、**反转 run loop + 事件循环（#439）**：新代码能在下一个 turn 生效，但都要改引擎与 manager 的控制流。两次尝试已经说明这条路的改动面不可接受。
- **每个 run 放进子进程**：swap 天然不打断，但审批、流、插话、subagent、用量记录全部要跨进程，改动面比 #439 更大。
- **不做**：插件重组已经让打断成为日常操作，不能不做。

本方案的依据是：状态已经集中，移交机制（registry、资源接口门、parked context）已经存在并由终端验证过。新增的只有一个数据组件和一个指针。

## Prior art
[prior-art]: #prior-art

- 本仓终端模块：pty 对象登记在 registry，parked 文档只带 id，继任代 claim；不兼容则 `disposeGroup`。本提案是同一模式用在 Session 运行时上。
- Erlang/OTP 的 code change：进程状态跨版本保留，`code_change` 判定与迁移；旧版本代码在仍被引用时继续存活，与这里「在途 Task 跑完旧代码」同理。

## Unresolved questions
[unresolved-questions]: #unresolved-questions

- 续跑消息（现为 `[harness_updated] …`）的措辞，以及是否在对话里向用户显示。
- 消息机器人触发的在途 Task：旧的消息桥随旧 App 停止，新的消息桥能否接住这次 run 的输出尚未验证（今天这样的 run 会被直接中止）。
- 兼容接手之后，空闲的 entry 是否应立即丢弃、下次访问时由新一代重新装载（让新的 core 代码尽早生效）。首版不丢弃：不改逻辑，空闲 30 分钟本来就会回收。
- 不兼容路径上是否一并 park 排队的 follow-up（输入可能含大图）。

## Future possibilities
[future-possibilities]: #future-possibilities

- 状态组件立住之后，turn 边界交接可以作为独立的后续提案：届时 run 的延续状态也进 `AgentState`，新代码在下一个 turn 生效。
- 同一模式可用于调度器、消息桥等今天在 swap 时「停止后重建」的模块。

## Changes

### v1.0.0

- 新增：迁入主仓；正文取设计仓的同一版本，与英文版逐节对应。
