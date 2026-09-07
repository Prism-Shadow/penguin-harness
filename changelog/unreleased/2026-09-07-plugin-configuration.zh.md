# 插件在系统设置弹窗里配置自己

- **Date:** 2026-09-07
- **Type:** feature
- **Scope:** `server`, `web`, `plugins`
- **PR:** [#641](https://github.com/Prism-Shadow/penguin-harness/pull/641)

[English](2026-09-07-plugin-configuration.md)

插件包现在可以声明自己需要的选项，管理员在系统设置弹窗新增的「**插件**」页里填写。再也不用为了一条插件的 Token 去改配置文件。

## 细节

- **在清单里声明。** `package.json#penguin.configuration` 是一份小 schema：标题与说明（带 `…Zh` 的中文半边）以及 `properties`，每个字段是 `string`、`secret`、`boolean`、`number` 或 `project` 之一，各带标题、说明、缺省值、占位文字与 `required`。loader 不运行包就读出它；页面画不出来的 schema 使该插件加载失败并点名文件。
- **服务端全局存储。** 值存在服务端设置的 `plugin-config:<包名>` 下，每包一份文档——插件按进程加载一次，选项因此也是进程的。密钥与服务端其他设置放在一起，一切 API 表面掩码显示；掩码原样送回即保持存储值，送空即清除。
- **经机制读取。** 模块在清单里 `requires` `PluginConfig`（来自 `PluginConfigModule`）：`get(name)` 答出合并到 schema 缺省值上的存储值，`watch(name, cb)` 在每次保存后触发——插件由此不重启、不重组 App 就应用改动。
- **「插件」页。** 在系统设置弹窗的服务器分组里，仅管理员，排在「沙箱」之后：每个声明了选项的已加载插件一张表单，按其 schema 画出——密钥字段留空、下方是存储值的掩码与清除勾选，Project 字段是 Project 选择器，布尔是开关。每个插件各自保存、一次 PUT；服务端拒绝的字段在该字段下标红。
- **API。** `GET /api/admin/plugin-config` 列出每个声明了选项的已加载包及其 schema 与掩码后的值；`PUT /api/admin/plugin-config {name, values}` 保存一个包的——400 `plugin_config_invalid` 点名被拒字段，404 `plugin_config_unknown` 表示该包没有声明选项。
