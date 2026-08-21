# Project 沙箱安全策略

- **Date:** 2026-08-20
- **Type:** feature
- **Scope:** `core`, `server`, `web`, `docs`
- **PR:** [#374](https://github.com/Prism-Shadow/penguin-harness/pull/374)
- **Breaking:** yes — every project starts denying the factory destructive commands (`rm -rf` and friends) under every approval mode; disable the offending rule (or the whole policy) in Project Settings to restore the old behavior

[English](2026-08-20-sandbox-command-policy.md)

新增 Project 级沙箱安全策略：一组拒绝规则，在审批回调**之前**对每次 `exec_command` 启动求值——命中即拒绝，任何审批模式（包括全部放行）都不能放过，并告知模型命中了哪条规则。策略存储为 `.project_config.toml` 的 `[command_policy]` 块（Project 所有的安全配置，处在 Agent 自有工具改不到的位置），Session 创建时读入 Environment 快照。Project 设置对话框也随之重构为分页布局。

## Details

- 规则是纯粹可编辑的数据，没有特殊层级。出厂规则集像模型预设一样播种进每个新项目（创建时拷入、之后绝不自动改写）；播种前的存量项目（未存列表）按出厂集生效，首次保存编辑即把列表物化进文件。每条规则——名称、pattern、可选描述、独立开关——都可编辑、停用、删除或新增；「恢复默认」把出厂集写回。
- 出厂规则集（刻意保持很小，每条都是一旦执行便不可挽回的命令）：任意写法的 `rm` 递归+强制、`mkfs`、`dd` 直写块设备、经典 fork bomb、重定向写入块设备；`/dev/null` 类目标仍然合法。
- 策略拒绝记录为带新增可选字段 `policy_rule` 的 `approval_decision`，并以点名规则的 `failed` 工具输出回馈模型——Trace 追加式字段；旧 Trace 读取不变，旧读取端忽略该字段。
- 新增路由 `GET|PUT /api/projects/:p/command-policy`（成员可读 / owner 可写）：GET 返回生效列表并附出厂集供恢复；PUT 携带完整列表并物化落盘，无法编译的 pattern 直接拒绝。
- 匹配是对启动命令做空白归一化后的正则：防事故护栏，不是安全边界（刻意混淆与 `input_command` 按键不在范围内；见配置文档「沙箱安全策略」一节）。
- Project 设置改为分页对话框——通用（显示名、Project ID、删除）、成员（权限表；单用户桌面版隐藏该页）、默认值（新对话默认值与默认模型）、安全策略（上述规则列表）——左侧页签导航，右侧行式设置页。

## 兼容性

存量与新建 Project 都会开始拒绝出厂集里的毁灭性命令，即使在全部放行模式下——依赖 `rm -rf` 的日常操作（如删除 `node_modules`）会收到点名规则的拒绝，模型被引导改用更安全的写法。要恢复某个具体行为，可在 Project 设置 → 安全策略中停用或编辑对应那一条规则（或整体关闭策略）；不涉及数据迁移。本改动之前创建的项目没有 `[command_policy]` 块，按出厂集生效，首次保存编辑时列表才写入 `.project_config.toml`。
