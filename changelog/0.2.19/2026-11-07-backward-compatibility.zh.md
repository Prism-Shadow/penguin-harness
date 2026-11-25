# 本批次的向后兼容

- **Date:** 2026-11-07
- **Type:** process
- **Scope:** `server`
- **PR:** [#1508](https://github.com/Prism-Shadow/penguin-harness/pull/1508)

[English](2026-11-07-backward-compatibility.md)

本批次的每项兼容决定都只在这里记录一次；各功能条目引用本文件，不再复述。

## 在 Agent 有作者之前创建的组织员工

[Agent 有了作者](2026-11-07-agent-author.zh.md)。此前创建的 Agent 在 `system_config.yaml` 里没有 `author`，而缺失的作者视为 `user`。对大多数 Agent 这是对的；对组织的员工却不对：它们由公司模式创建，升级后却会被列在**用户创建**组里。

选定方案（所有者决定）：**在读取 Agent 列表时做一次性迁移。** 每当 `GET /api/projects/:projectId/agents` 作答，服务端先取出 Project 各组织雇用的 Agent（即列表的 `employments`：每个组织目录的组织图里的每一项，暂停的组织也算，另加组织图无法解析时的 CEO）。配置里没有 `author` 键的员工被写入 `author: company`：

- 与配置的 `PUT` 一样，经 yaml `parseDocument` 就地修改文件，注释与格式原样保留。新键紧跟在 `description` 之后，没有描述时跟在 `name` 之后。
- 已有的键无论取值如何都不覆盖。在 Agent 设置里改回 `user` 的员工保持 `user`。
- 无法解析的配置保持原样。组织图点名、而目录中没有配置的员工不会因此新建文件。
- 文件有了作者之后，之后的读取不再写入。
- 没有被任何组织雇用的 Agent 不受影响，继续视为 `user`。

### 生效范围

所有服务端（包括机器）上每个 Project 的 Agent：每个服务端在读取自己的列表时为自己的 Agent 补写。只写入组织员工。

### 用户需要做什么

无需操作。打开智能体页，或运行 `penguin agent ls`，读取列表即完成迁移。

### 保留期限

服务端维护者保留这段代码直到下一个大版本（1.0），并在该版本的发布准备中移除：`packages/server/src/services/agent-author-migration.ts`、它在 Agent 列表路由（`packages/server/src/http/routes/agents.ts`）中的调用、`AgentConfig.stampMissingAuthor`（`packages/server/src/mechanisms/agents.ts`、`packages/server/src/services/agent-config-service.ts`），以及 `packages/server/test/agent-author.test.ts` 中的迁移场景。它写入的 `author` 留在文件里。

## 兼容性

升级时无需操作。降级之后，旧版本会忽略 `author` 键：就地编辑配置时它保留这个键，但它的**还原为默认配置**会丢掉它。这样丢了键的员工在下次升级时会被重新补写，其他 Agent 视为 `user`。
