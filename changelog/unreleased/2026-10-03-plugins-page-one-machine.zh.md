# 插件页一次只看一台机器

- **Date:** 2026-10-03
- **Type:** fix
- **Scope:** `web`, `docs`
- **PR:** [#1014](https://github.com/Prism-Shadow/penguin-harness/pull/1014)

[English](2026-10-03-plugins-page-one-machine.md)

插件页此前默认是「所有机器」视图，Installed 与 Available 只按共用表 `[plugins]` 判断，机器选择器也只在有别的机器时出现。写进本机自己的表 `[plugins.<machineId>]` 的插件（沙盒卡片安装后端就是这样写的）会同时在 Installed 里标「仅在 本机」、在 Available 里显示没装，单机部署也切不到本机视图。现在插件页始终只看一台机器，默认本服务。

## 细节

- 选择器去掉「所有机器」一项，先列本服务，再列 Project 能到达的机器与表里点名的机器；只有一台机器时照旧不显示。选中的机器离开候选（最后一个会话结束，或不再有表点名它）时，页面回到本服务，而不是停在选择器已隐藏、无法切走的机器上。
- Installed 列出所看机器自己的表与共用表的并集。共用表的行带标签**所有机器共用**，不能在页面上移除，悬停说明它在 Project 配置中对所有机器统一管理；共用插件即使又被本机表钉住（按机器覆盖），也按共用行显示、只读：把它从本机表中去掉，它仍会继续运行。本机表的行不带标签，可以移除。Agent 与 API 照旧可以修改共用表。共用行被禁用的移除按钮通过 aria-describedby 关联标签与说明，读屏器能读出原因。
- Available 列出索引里与该机器构建自带的、两张表都没让它在该机器上运行的插件；只为别的机器装的插件照常可装。
- 页面上的安装与移除一律写进所看机器自己的表，在读到本服务的机器 id 之前不可用。
- 删除「仅在 …」标签与「本机不运行」状态，以及词条 `allMachines`、`onlyOn`、`notHere`、`sharedCannotRemove`；新增 `sharedTag` 与 `sharedHint`。
- 插件文档（`packages/docs/content/plugins.*.md`）改为描述单机视图：安装与移除写进所看机器自己的表，共用行只读。
