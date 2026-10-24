# 基座的登录期 provider、layer 与用户事件改为槽位

- **Date:** 2026-10-03
- **Type:** refactor
- **Scope:** `web`

[English](2026-10-03-web-WebApp-slots.md)

Web App 基座原先逐个点名 feature 的三处，改为由 feature 向槽位贡献。`WebAppSlots` 增加 `sessionProviders`（登录期的 provider，挂在 Project 与 Sessions 之内，由外到内）与 `layers`（挂在每个页面旁、只挂一次的浮层与无界面运行时），都按 `order` 排序。新增的 `SessionsModule` 拥有 `userEvents` 槽位：每条贡献是一个带 `event(ev, source)` 与可选 `resync(source)` 的处理器，模块按顺序以 `UserEventHandlers` 接口提供它们，WebApp 取得后交给 `SessionsProvider`。

- company 的状态从 `state/company.tsx` 搬到 `features/company/company-state.tsx`。`CompanyModule` 把 `CompanyProvider` 贡献到 `WebAppModule.sessionProviders`，路由的 `RequireAuth` 嵌套各模块贡献的 provider，不再点名它。其余代码经 `features/company/index.ts`（`useCompany`、`useCompanyOptional`）读取。`/` 与所有未匹配的路径由 company 模式的 `home` 页面（路径 `*`，`HomeRedirect`）导向首页，因为首页取决于模式，路由因此不再读取 company 状态。
- `AppLayout` 原先挂一次的四个组件改由各自的拥有方以 `WebAppModule.layers` 贡献，挂载顺序不变：终端视图池的运行时（`TerminalModule`）、快捷键运行时（新增 `SettingsModule`）、内置浏览器层（新增 `BuiltinBrowserModule`）、命令面板（新增 `PaletteModule`）。
- `applyUserEvent` 以参数接收处理器。列表仍先处理自己的事件；resync 调用每个处理器的 `resync`，其余事件先交给每个处理器，列表再为定时任务触发刷新。company（调度器的事件与插件自己的事件）、内置浏览器（只认本服务器的事件）与 schedules（新增 `SchedulesModule`）在各自的 `module.ts` 里贡献处理器。
- `state/` 与 `web-app/router.tsx` 不再 import 任何 feature。边界测试把 `<name>.module.ts` 也视为模块文件；基线删去 12 条、新增 3 条（`app-layout.tsx` 与 `sidebar.tsx` 读取 `features/company/index.ts`，以及 settings 进入 company 与 chat 原本就在的环）。
- 用户可见的行为没有变化。
