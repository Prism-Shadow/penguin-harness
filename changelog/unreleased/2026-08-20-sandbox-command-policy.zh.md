# Project 沙箱安全策略

- **Date:** 2026-08-20
- **Type:** feature
- **Scope:** `core`, `server`, `web`, `docs`
- **PR:** [#374](https://github.com/Prism-Shadow/penguin-harness/pull/374)
- **Breaking:** yes —— 所有 Project 开始在任何审批模式下拒绝出厂集里的毁灭性命令（`rm -rf` 之类）；要恢复原有行为，在 Project 设置里停用对应规则或整个策略

[English](2026-08-20-sandbox-command-policy.md)

新增 Project 级沙箱安全策略：一组拒绝规则，在审批边界上对每次 `exec_command` 启动生效——命中即拒绝，任何审批模式（包括全部放行）都不能放过，并告知模型命中了哪条规则。`Session.run` 用策略包装注入进来的审批回调，因此拒绝发生在任何宿主被问到之前，`context_engine` 仍然只处理 OmniMessage。规则存储为 `.project_config.toml` 的 `[command_policy]` 块（Project 所有，Agent 改自己的配置改不到它），并在 Session 创建时读入快照。Project 设置对话框也随之重构为分页布局。

## 细节

- 规则是纯粹可编辑的数据，没有特殊层级。出厂规则集像模型预设一样播种进每个新项目（创建时拷入、之后绝不自动改写）；播种前的存量项目（未存列表）按出厂集生效，首次保存编辑即把列表物化进文件。每条规则——name、pattern、可选 description、每条 enabled——都可编辑、停用、删除或新增；「恢复默认」把出厂集读回编辑区，由 Save 落盘。
- 出厂规则集（刻意保持很小，每条都是一旦执行便不可挽回的命令）：同时带递归与强制标志的 `rm`、`mkfs`、`dd` 直写块设备、经典 fork bomb、重定向写入块设备；带路径（`/bin/rm`）与 `sudo` 同样命中，`/dev/null` 类目标仍然合法。
- `ApproveFn` 的拒绝现在可以不返回裸的 `"deny"`，而返回 `ApprovalRefusal`——决定加上要回报的消息与 stop_reason。策略拒绝以点名规则的 `failed` 工具输出回馈模型，与人工取消仍然产出的 `aborted` 输出区分开；返回 `"allow"` / `"deny"` 的既有回调行为完全不变。
- 新增路由 `GET|PUT /api/projects/:p/command-policy`（成员可读 / owner 可写）：GET 返回生效列表并附出厂集供恢复；PUT 携带完整列表并物化落盘，无法编译的 pattern 直接拒绝。
- 匹配是对单个工具的启动命令做空白归一化后的正则：防事故护栏，不是安全边界。嵌套解释器（`sh -c`、`eval`、管道喂给 `bash`）、shell 层的间接（给命令词加引号、`$IFS`、走变量）、通过 `input_command` 敲进已运行 shell 的按键、MCP Server 自带的 shell，以及一切不在名单上的命令，都能从旁边走过去。见配置文档「沙箱安全策略」一节。
- Project 设置改为分页对话框——通用（显示名、Project ID、删除）、成员（权限表；单用户桌面版隐藏该页）、默认值（新对话默认值与默认模型）、安全策略（上述规则列表）——左侧页签导航，右侧行式设置页。

## 兼容性

存量与新建 Project 都会开始拒绝出厂集里的毁灭性命令，即使在全部放行模式下——依赖 `rm -rf` 的日常操作（如删除 `node_modules`）会收到点名规则的拒绝。要恢复某个具体行为，可在 Project 设置 → 安全策略中停用或编辑对应那一条规则（或整体关闭策略）；不涉及数据迁移。本改动之前创建的项目没有 `[command_policy]` 块，按出厂集生效，首次保存编辑时列表才写入 `.project_config.toml`。
