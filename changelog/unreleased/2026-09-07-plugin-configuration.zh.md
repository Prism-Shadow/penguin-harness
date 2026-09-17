# 插件在设置弹窗里配置自己

- **Date:** 2026-09-07
- **Type:** feature
- **Scope:** `server`, `web`, `plugins`
- **PR:** [#769](https://github.com/Prism-Shadow/penguin-harness/pull/769)

[English](2026-09-07-plugin-configuration.md)

模块——插件的，或 harness 自己的——现在可以声明自己需要的设置，管理员在设置弹窗新增的「**插件**」页里填写。再也不用为了一条插件的 Token 去改配置文件。

## 细节

- **以 contribution 声明。** 一个设置分组是投给 `PluginConfigProvider.groups` 的一条 contribution：纯清单数据，插件的声明因此与它的其他 contribution 一起落进生成的 `ifaces.json`，页面不运行包就能列出它。contribution 的 id 即分组名；数据是一份小 schema——标题与说明（带 `…Zh` 的中文半边）以及 `properties`，每个字段是 `string`、`secret`、`boolean`、`number`、`enum`（带 `options`）或 `list`（按行，可选 `maxItems`）之一，各带标题、说明、缺省值、占位文字与 `required`——另可带 `parent`（把本分组画进另一个分组的卡片）与 `order`。运行时状态会变的分组向 `PluginConfigPage.status` 投递实时提示行。声明写坏了只丢弃那个分组并告警，不影响整页。
- **服务端全局存储。** 值存在服务端设置的 `plugin-config:<分组名>` 下，每个分组一份文档——插件按进程加载一次，选项因此也是进程的。密钥与服务端其他设置放在一起，一切 API 表面掩码显示；掩码原样送回即保持存储值，送空即清除。
- **由声明它的模块自己读取。** 模块 `requires` `PluginConfig`（来自 `PluginConfigModule`），拉取自己的分组：`get(name)` 答出合并到声明缺省值上的存储值，`watch(name, cb)` 在每次保存后触发，`saved(name)` 区分已保存的选择与缺省值。没有谁替模块转交这些值，各模块自己把文档转成带类型的设置。
- **纯数据不决定创建顺序。** 模块树只在槽要求代码半时才让槽的所有者晚于投稿者创建：纯数据的 contribution 在任何节点创建之前就已存在，所以同一个类可以既声明分组、又 requires `PluginConfig`。
- **「插件」页。** 在设置弹窗的服务器分组里，仅管理员：每个没有 parent 的分组一张卡片，子分组画在卡片里，按 schema 画出——密钥字段留空、下方是存储值的掩码与清除勾选，布尔是开关，枚举是下拉框，列表是按行填写的文本框。每张卡片各自保存，卡片内每个改动过的分组一次 PUT；服务端拒绝的字段在该字段下标红。插件列表页的页头另有一个齿轮图标按钮（仅管理员），直接打开设置弹窗的这一页。
- **API。** `GET /api/admin/plugin-config` 按顺序列出每个已声明的分组及其 schema、掩码后的值、`parent` 与提示行；`PUT /api/admin/plugin-config {name, values}` 保存一个分组的——400 `plugin_config_invalid` 点名被拒字段，404 `plugin_config_unknown` 表示没有分组叫这个名字。
