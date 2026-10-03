# 侧栏改由槽位填充

- **Date:** 2026-10-03
- **Type:** refactor
- **Scope:** `web`

[English](2026-10-03-web-sidebar-slots.md)

Web App 的侧栏框架、折叠窄栏与应用布局不再 import 任何 feature 的内部文件：各 feature 放进来的内容经模块槽位与接口到达。

- `SidebarModule`（`web-app/sidebar/`）提供 `Sidebar`（侧栏、窄栏，以及给布局用的状态），声明三个槽位：`sections`（某个工作模式的分区，位于切换器一行或滚动区；分区的 scope 跨模式切换保持挂载，会话列表因此保留状态）、`modes`（开发模式之外的工作模式）、`navBadges`（页面行、账户行或手机抽屉按钮上的标记）。贡献方实现的形状在 `lib/sidebar-contributions.ts`。
- `ChatDrafts`（`features/chat/iface.ts`，由新增的 `features/chat/index.ts` 导出）是 chat 模块的草稿接口：会话列表与 WebApp 以 `@Use` 取用，不再直连草稿文件。
- `SessionListModule` 贡献开发模式分区，声明 `rowActions`（会话行或工作区分组菜单中的一项，或行标记；形状在 `lib/session-row-contributions.ts`）。messaging 贡献绑定菜单项与转发标记，schedules 贡献定时标记，dock 贡献「浏览文件」。
- company 贡献其工作模式与三个分区；projects 贡献项目切换器；models 贡献账户行上的余额；todos 贡献更新圆点，并以会话 provider 挂载唯一主动拉取的来源。停靠区作用域与设置对话框改为 layer；`settings-request.ts` 移到 `lib/`。
- 导航行由页面表绘制：`WebAppModule.pages` 的数据增加 `title` / `titleZh` / `icon`（图标注册表中的名字）。删除 `NavGroupKey` 闭集，以及只有导航使用的 `NAV_ICONS` 项与 `S.nav` / `S.company` 词条；已存的导航折叠与常驻选择键与值不变。
- 边界测试把 `shell/` 当作模块目录（只经对方 `index.ts` 引用其他模块）。基线从 195 行变为 156 行：库→feature 25 → 0，feature→feature 136 → 122，环保持 34。
- 用户可见的行为没有变化。
