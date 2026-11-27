# 安装 build 自带的插件改为拒绝，不再被静默遮蔽

- **Date:** 2026-11-27
- **Type:** fix
- **Scope:** `server`

[English](2026-11-27-shipped-plugin-install-refused.md)

## 细节

- 此前以 build 自带插件的名字安装插件包（例如 `@penguinharness/trace-lookup`）会成功：npm 把新版写进数据根的插件前缀，但插件库读取时 build 自带副本优先于前缀，装上的版本永远不会被列出或加载——更新被静默遮蔽，无错误、卡片也无提示。
- 现在这类安装在做任何 npm 操作前即以 `409 plugin_shipped` 拒绝，拒绝说明 build 自带的版本，并说明更新该插件需要等 build 发版。同一拒绝也覆盖以自带插件名字链接的目录与上传的 zip（包会从前缀被取回），各安装路径的答复一致。安装 build 未自带的插件不受影响。
