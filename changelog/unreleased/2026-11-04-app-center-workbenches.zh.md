# 应用中心改为 Workbench 应用的桌面

- **Date:** 2026-11-04
- **Type:** feature
- **Scope:** `server`, `web`, `ui`, `ui-gallery`, `plugins`, `docs`, `rfcs`
- **PR:** [#1488](https://github.com/Prism-Shadow/penguin-harness/pull/1488)

[English](2026-11-04-app-center-workbenches.md)

侧栏新增**应用中心**入口（`/apps`），缺省收藏，排在智能体之后。它是 Project 的桌面：本服务端该 Project 各 Agent 的工作台中，凡自己的 `package.json` 声明了 `penguin.appCenter.show: true` 的，各占一个图块，图块只有应用的图标与名称。点击在网格上方的窗口里打开应用，图块的菜单可全屏打开。查看者可拖动图块排序、收纳成分组，或用页头的**新建分组**建分组，排列随账号保存。仍在构建的应用显示旋转圆环，构建完成后才能打开。

## 细节

- 工作台清单新增 `penguin.appCenter { show, title?, titleZh?, icon?, tab? }`。标题缺省取首个标签页的标题，再缺省取包名；`icon` 为 `ui/` 下不超过 256 KB 的 SVG、PNG、JPEG、WebP、GIF 或 AVIF 文件，文件头须与扩展名相符；`tab` 指定快捷入口打开的标签页。声明不合规不会让加载失败：该工作台不出现在应用中心，加载提示与 `.build/status.json` 写明如何修正。`WorkbenchInfo.appCenter` 给出解析后的声明。
- `GET /api/projects/:projectId/app-center` 应答 `{ shortcuts, layout }`。每个 `AppCenterShortcut` 带标题、以 `{ url, tint }` 给出的 `icon`、整页路径、`tab` 与 `build`：加载进行中或已排队为 `building`，上次加载失败为 `failed` 并附记录的 `error`，其余为 `ready`。列表只读清单与加载状态，不编译任何东西；它为所列 Agent 启动文件监视，只列本服务端的 Agent。
- 一次加载开始时，用户事件流推送 `workbench_building { projectId, agentId, workbenchId }`，结束时照旧推送 `workbench_updated`。构建中的图块不能打开，构建完成后自动恢复。
- 图标沿用插件图标的规则（[#1514](https://github.com/Prism-Shadow/penguin-harness/pull/1514)）：由 core 的 `iconImage` 检查，`GET /api/projects/:projectId/agents/:agentId/workbenches/:id/app-center/icon` 以服务端共用的图标应答返回——内容类型按文件头给出，带 `X-Content-Type-Options: nosniff`、`Content-Security-Policy: default-src 'none'; style-src 'unsafe-inline'; sandbox` 与 `Cross-Origin-Resource-Policy: same-origin`——地址中的 `rev` 随字节变化。Web App 以 `ImageIcon` 绘制，单色 SVG 取文字颜色，从不作为标记插入。
- 查看者的顺序与分组按账号与 Project 存于 `ui_prefs.appCenterLayouts`，形如 `AppCenterLayout { v: 1, items }`，经 `PUT /api/projects/:projectId/app-center/layout { layout | null }` 写入（`null` 恢复默认排列）。服务端校验形状，不合规整体拒绝；`PUT /api/me/prefs` 拒绝该键。新应用追加在末尾，消失的应用移出，分组空了才去掉：只有一个应用的分组照常保留。
- 把图块拖到两个图块之间即移动，拖到另一图块上合成名为**新建分组**的分组（可重命名），拖到分组上即加入；打开的分组是网格上方的面板，把图块拖出即移出分组。松手之前图块不移动：落点处的竖线或目标外的描边圈标示松手的结果，图块的 `data-drop` 给出其名。
- 页头的**新建分组**——也是网格空白处菜单与图块「移动到…」的第一项（**新建分组…**）——打开对话框：名称初始为**新建分组**并处于选中状态；下方是所有应用（带图标）的勾选列表，已在分组中的应用注明所在分组，勾选即从那里移出。勾选至少一个应用后**创建**才可用；新分组位于勾选的第一个应用的位置，经同一个排列写入保存。从图块菜单打开时，该应用已勾选。
- 每个图块、分组与网格空白处都有右键菜单：打开、全屏打开、移动到…、向前 / 向后移动、移出分组、查看错误、在 Agent 设置中查看、从应用中心移除；分组另有重命名与解散分组；空白处有**新建分组…**与**恢复默认排列**，后者先确认。键盘与触屏经这些菜单整理网格。
- `PATCH /api/projects/:projectId/agents/:agentId/workbenches/:id/app-center` `{ show }` 只改写工作台 `package.json` 中的 `penguin.appCenter.show`（2 空格缩进，其余键不变），随后重新加载并记为一个版本。`package.json` 不是 JSON 对象时应答 409 `workbench_manifest_invalid`。Agent 设置中，本服务端 Agent 的每个工作台行（[#1497](https://github.com/Prism-Shadow/penguin-harness/pull/1497) 起位于插件标签页）新增应用中心开关（即拨即存），旁有文字**应用中心**（点击文字同样拨动，较长的说明作为悬停提示）。
- 工作台行写明各控件的作用：**打开**是文字按钮；两个开关各带文字**启用**与**应用中心**；重新加载、**历史版本**、打包导出与移除（仍先确认）从裸图标按钮收进**更多**（⋯）菜单。行首在工作台声明了应用中心图标时显示该图标，否则为所属插件的图标或铁砧图块；`WorkbenchInfo.icon` 以与快捷入口相同的 `IconRef` 给出它，机器上的 Agent 则改指向该机器。机器上 Agent 的行没有应用中心开关。
- 被自身或 Agent 级启停开关（[#1496](https://github.com/Prism-Shadow/penguin-harness/pull/1496)）关闭的工作台不出现在应用中心；它的行照常给出应用中心声明与图标，应用中心开关只改写清单、不加载它。
- 从应用中心打开的工作台整页，退出时回到应用中心；从窗口进入的回到该窗口。
- `packages/ui` 新增 `ContextMenu`：单个目标的菜单，右键在指针处打开，Shift+F10 或 ContextMenu 键在聚焦的目标处打开，触屏长按打开；Esc 关闭并交还焦点；嵌套的目标由最内层承接手势，其余位置保留浏览器自带菜单。`isContextMenuKey` 同时识别 ContextMenu 键，各行菜单一并受益。`InstallRing` 是构建中的圆环。组件画廊的选择器页演示右键菜单，新增的应用中心页面展示各图块状态与一个分组。
- 没有快捷入口时，页面说明工作台是什么，并提供**用 AI 创建**：以 `web-design` 与 `penguin-plugin` 两个 Skill 打开新对话，请 Agent 做一个出现在应用中心的工作台。
- `penguin-support` 插件的 Support 工作台声明 `appCenter: { show: true, icon: "ui/icon.svg" }` 并换上新图标，`penguin.version` 改为 `2026.11.04.1`。`penguin_support` 上已装的副本会报告一次插件更新，更新后出现在应用中心。
- `penguin-plugin` Skill（`2026.11.09.1`）新增讲解该清单键的「App Center」一节。
- [#595](https://github.com/Prism-Shadow/penguin-harness/pull/595) 的外部应用注册表、探活、`[app_center]` 来源块、`penguin app` CLI 与 `app-center` Skill 不予采纳。
- `rfcs/PRFC-0020-agent-workbench.md` 升至 v1.3.0，含「应用中心」一节。
