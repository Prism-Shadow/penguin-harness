# 向后兼容：会话来源成为必填之前的 Trace 与调用方

- **Date:** 2026-10-07
- **Type:** process
- **Scope:** `core`, `server`, `web`, `cli`

[English](2026-10-07-backward-compatibility.md)

[会话来源成为必填](2026-10-07-session-source.zh.md)，`benchmark` 也已停用。有两样东西会延续到新版本：磁盘上已有的 Trace，以及仍在发送这个已停用取值的调用方。

## 旧形态：没有 `source`、或为 `benchmark` 的 `session_meta`

此前写下的 Trace，人发起的对话不带 `source`，`penguin run --source benchmark` 启动的被测会话带 `benchmark`。服务器派生的 `trace_sessions` 缓存里存的也是这些值，或为 NULL。Trace 从不改写。每次读取 Trace 开头时，都经 `packages/core/src/omnimessage/source.ts` 中的 `normalizeSessionSource` 收窄：没有 `source` 读作 `user`，`benchmark` 读作 `cli`。这覆盖了会话列表的分类、启动时对未入索引 Trace 的收编、恢复的 Session（之后开启的每个上下文都记录收窄后的值）、子 Agent 转发的 meta，以及 Web App 回放的子会话 meta。

有两个调用方仍会发送这个已停用的取值，在下文的移除之前都按同一含义接受：

- 较旧的 CLI 或 Web App 以 `source: "benchmark"` 调用 `POST /api/projects/:projectId/agents/:agentId/sessions`，创建的是 `cli` 会话。
- 已安装的 agent-evaluation Skill 副本仍会传 `penguin run --source benchmark`，运行时视同未传该参数，并打印一行提示。`--source` 的其他取值仍报错。

较旧的 Web App 留在浏览器里、带评估标记的新对话草稿，加载时丢弃这个标记，创建的是普通对话；这一点不保留任何代码。

**用户无需任何操作。** 旧会话列在其类别所属的折叠夹中；已安装的评估 Skill 在更新之前照常可用。

## 何时可以移除

在 0.3.0 发布准备时，由负责该次发布的人移除。读取 Trace 不会改写其开头，因此此版本之前创建的 Session，其开头永远不带 `source`：只删掉 `undefined` 分支，会让所有这类对话都成为格式错误的开头，收编时跳过、恢复时拒绝。所以负责发布的人须先与用户确定一件事：一次性改写旧的开头（按收窄结果补写 `source` 的迁移），或永久保留这一个分支。`benchmark` 分支与下列别名不受影响，照常移除。移除的内容：

- `normalizeSessionSource` 中标有 `compat(0.3.0)` 的分支（`undefined` 分支须待上述问题确定后再处理）；开头没有合法来源的 Trace 即视为格式错误，收编时跳过、恢复时拒绝，与没有 `provider` 的开头一样；
- 创建路由中的 `benchmark` 别名（`packages/server/src/http/routes/sessions.ts`）；
- `penguin run` 隐藏的 `--source` 选项（`packages/cli/src/commands/run.ts`）及其在 `packages/cli/src/i18n.ts` 中的两条文案；
- `packages/core/test/session-source.test.ts`、`packages/server/test/session-source.test.ts`、`packages/server/test/trace-index.test.ts` 与 `packages/cli/test/server-commands.test.ts` 中对应的用例。
