# 插件设置可以逐台机器编辑

- **Date:** 2026-09-17
- **Type:** feature
- **Scope:** `web`
- **PR:** [#450](https://github.com/Prism-Shadow/penguin-harness/pull/450)

[English](2026-09-17-plugin-config-per-machine.md)

设置弹窗的「插件」页新增机器选择器，在 Project 连接了其他机器时出现。选中某台机器后，读取、保存与执行动作都经 `/server/<machineId>/api/admin/plugin-config` 作用于那台机器自己的插件设置。每台服务端把设置存在自己的数据库里，机器之间不互相复制。无法应答的机器显示空页面，并注明原因。
