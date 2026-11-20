# 选择哪些工作台显示在侧边栏

- **Date:** 2026-11-19
- **Type:** feature
- **Scope:** `server`, `web`
- **PR:** [#1624](https://github.com/Prism-Shadow/penguin-harness/pull/1624)

[English](2026-11-19-workbench-sidebar-setting.md)

Agent 设置「插件 → 工作台」子页面上，每个工作台行的「更多」菜单新增可勾选的「展示到侧边栏」，默认勾选。这一设置属于该安装：它是工作台目录里与 `.disabled` 并列的标记文件 `.hidden-from-sidebar`，因此 Project 的所有成员看到同一个选择；改动它不记版本，插件更新与压缩包导入都会保留它。对话旁的工作台标签页跟随这一设置；对隐藏的工作台点「打开」，会进入它的整页。应用中心不受影响。

## 细节

- `PATCH /api/projects/:p/agents/:a/workbenches/:id/sidebar { show }` 写入或删除该标记，Project 的任意成员均可操作。`WorkbenchInfo.showInSidebar` 报告它的值；Agent 所在的服务端不报告该项时，菜单里不显示这一行。
- `GET /api/projects/:p/agents/:a/workbenches?view=sidebar` 应答 `{ apps }`：每个已启用、至少有一个标签页且未隐藏的工作台各一个应用中心快捷入口，无论它是否声明显示在应用中心。它用应用中心的读取函数读清单与加载状态，不编译任何东西。
- 机器上的 Agent，这一设置写在那台机器上。
