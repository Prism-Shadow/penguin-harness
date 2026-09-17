# 设置弹窗里的插件设置，沙盒是第一批用户

- **Date:** 2026-09-07
- **Type:** feature
- **Scope:** `core`, `server`, `web`, `plugins`, `docs`
- **PR:** [#769](https://github.com/Prism-Shadow/penguin-harness/pull/769)

[English](2026-09-07-plugin-configuration.md)

模块（无论是插件的还是 harness 自己的）可以声明自己需要的设置，管理员在设置弹窗新增的「**插件**」页里填写。沙盒与它的后端最先用上了这套机制。

## 声明与读取设置

- **设置分组是一条 contribution**，投给 `PluginConfigProvider.groups`。它是清单数据，因此插件的分组会写进生成的 `ifaces.json`，页面不运行包就能列出它。contribution 的 id 即分组名。数据包括标题、说明（带供中文界面使用的 `…Zh` 字段）以及 `properties`。每个字段是 `string`、`secret`、`boolean`、`number`、`enum`（带 `options`）或 `list`（按行，可选 `maxItems`）之一，各带标题、说明、缺省值、占位文字与 `required`。`number` 可声明 `minimum` 与 `maximum`，`string` 与 `list` 可声明 `pattern`（配 `patternErrorMessage`），每个值或每一行都须匹配。分组还可以设置 `parent`，画进另一个分组的卡片里，以及 `order`。
- **实时提示行**来自投给 `PluginConfigPage.status` 的代码 contribution，用于运行时状态会变化的分组。可选的 `saved()` 在卡片保存后执行，PUT 的应答会等它引发的工作完成后才返回。声明写错时只丢弃那个分组并告警，页面其余部分照常加载。
- **值在服务端全局存储**，每个分组一份文档，存在服务端设置的 `plugin-config:<分组名>` 下，因为插件按进程只加载一次。密钥在所有 API 返回中都以掩码显示。原样送回掩码即保留存储值，送空值即清除。
- **由声明分组的模块自己读取。** 模块 `requires` 来自 `PluginConfigModule` 的 `PluginConfig`：`get(name)` 返回合并到声明缺省值上的存储值，`watch(name, cb)` 在每次保存后触发，`saved(name)` 区分已保存的选择与缺省值。
- **纯数据的 contribution 不决定启动顺序。** 模块树只在槽接收代码时，才让槽的所有者晚于投稿者创建。因此同一个类可以既声明分组，又 requires `PluginConfig`。
- **API。** `GET /api/admin/plugin-config` 按顺序列出每个已声明的分组，含 schema、掩码后的值、`parent` 与提示行。`PUT /api/admin/plugin-config {name, values}` 保存一个分组。字段被拒时返回 400 `plugin_config_invalid` 并点名该字段，名字不存在时返回 404 `plugin_config_unknown`。

## 「插件」页

- **「系统设置」弹窗更名为「设置」**（英文界面由 System settings 改为 Settings），侧边栏用户菜单、文档与其他未发布条目一并更新。服务器分组新增「插件」页。
- **该页仅管理员可见**，每个没有 parent 的分组一张卡片，子分组画在卡片内。密钥字段初始为空，下方显示存储值的掩码与清除勾选。布尔值是开关，枚举是下拉框，列表是按行填写的文本框。
- **每张卡片各自保存**，卡片内每个改动过的分组各发一次 PUT，只带改动过的字段，未动过的缺省值不会被存成值。服务端拒绝的字段在该字段下标出。
- **插件列表的页头**新增齿轮按钮（仅管理员），直接打开设置弹窗的这一页。

## 沙盒卡片

- **沙盒是一个设置分组**，排在该页最前：封禁模式（关闭、仅工作区可写或只读）、是否断开网络、系统临时目录是否可写（默认开启，两种模式都生效），以及对被封禁命令屏蔽的绝对路径。它存为 `plugin-config:sandbox`。改动对下一次命令启动生效，无需重启，重启后仍保留。
- **后端声明自己的分组**，在 `SandboxModule.providers` contribution 旁设 `parent: "sandbox"`，并在每次启动命令时经 `PluginConfig` 读取。bwrap 声明了程序路径与 1–30 秒的探测超时，Seatbelt 声明了程序路径。换了程序会重新探测。后端绑定的是加载函数（`SandboxProviderSource` 现在也接受函数），因此启动时未通过自检的后端（例如程序路径写错）在沙盒卡片保存后会重新加载，无需重启。
- **卡片说明由谁实施封禁。** 卡片列出正在使用的后端及各自实现的隔离维度。未通过加载时自检（[沙盒后端](2026-09-17-sandbox-backends.zh.md)）的后端点名并给出原因。面向其他平台的后端只在没有任何后端可用时才点名。当保存的模式需要的隔离没有可用后端实现时，卡片警告 Agent 的每条命令都会被拒绝。一个可用后端都没有时，卡片说明除关闭外的任何模式都会拒绝 Agent 的每条命令。
