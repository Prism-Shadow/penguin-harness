# Agent 记录作者，智能体页按作者分组

- **Date:** 2026-11-07
- **Type:** feature
- **Scope:** `core`, `server`, `cli`, `web`, `skills`
- **PR:** [#1508](https://github.com/Prism-Shadow/penguin-harness/pull/1508)

[English](2026-11-07-agent-author.md)

每个 Agent 现在都在 `system_config.yaml` 顶层的 `author` 里记下由谁创建，与 `name`、`description` 并列。取值为 `user`（用户在 Web App 中创建）、`agent`（智能体在对话中创建）或 `company`（公司模式创建）。值缺失或不认识时视为 `user`。智能体页按作者给列表分组。

## 创建路径

- Web App 的**创建 Agent**对话框发送 `author: user`。
- `POST /api/projects/:projectId/agents` 接受 `author`，缺省为 `user`。其他取值在创建任何东西之前即以 400 拒绝。
- `penguin agent create` 新增 `--author <user|agent|company>`。不带该选项时，在对话中运行（设置了 `PENGUIN_SESSION_ID`）即发送 `agent`，否则不发送，由服务端记为 `user`。取值不认识时在发出任何请求之前以退出码 1 结束。
- 公司模式为新组织的 CEO 和招聘时新建的员工写入 `company`。招聘已有的 Agent 不改变它的作者。
- **用 AI 创建**所运行的 `agent-initialization` 技能会在新建的 Agent 里写入 `author: agent`，校验时也检查它；**用 AI 创建**对话框的固定说明同样要求这样做。
- 导入的 Agent 保留包里自带的 `author`。在对话中从其他编程工具迁移 Agent 的 `agent-porting` 技能，会在它导入的包里写入 `author: agent`。

## 读取与编辑

- Agent 列表（`AgentSummary.author`）与配置视图（`AgentConfigDto.author`）都带上生效的作者。`PUT …/config` 就地写入 `author` 并保留注释；文件里原本没有这个键时，新键紧跟在 `description` 之后，没有描述时跟在 `name` 之后。**还原为默认配置**与内核更新都保留它。
- Agent 设置的**概览**标签页新增**作者**下拉框（**用户**、**智能体**、**公司模式**）。它属于概览表单，由**保存**写入，**重置**恢复。

## 智能体页

- 页头搜索框之后新增分组下拉框：**按作者分组**（缺省）或**不分组**，浏览器会记住所选的方式。
- 按作者分组时，列表依次显示**用户创建**、**智能体创建**、**公司模式创建**三组，没有 Agent 的组不显示。组标题可以像插件库页那样折叠，浏览器记住折叠了哪些组，搜索时它留下的组一律展开。组内的卡片不再各带边框；组织的员工归入其作者所在的组，卡片上照旧写出任职的组织，不再单列**公司模式员工**一节。
- **不分组**即原来的列表：单列显示，员工单独列在末尾一节。
- 各处的 Agent 选择器与侧栏不变。

## 已有的 Agent

此前创建的组织员工会被一次性标为 `company`，见[向后兼容](2026-11-07-backward-compatibility.zh.md)。
