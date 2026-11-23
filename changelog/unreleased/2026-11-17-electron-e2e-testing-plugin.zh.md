# penguin-testing-electron 驱动真实 harness 壳做端到端验证

- **Date:** 2026-11-17
- **Type:** feature
- **Scope:** `plugins`
- **PR:** [#1581](https://github.com/Prism-Shadow/penguin-harness/pull/1581)

[English](2026-11-17-electron-e2e-testing-plugin.md)

新插件 `penguin-testing-electron`：被测插件不再对着 mock 出的壳验证，而是对着真实的 harness 桌面壳（Electron 运行时）做端到端验证。Playwright 的 Electron 通道起当前检出的壳（或指定构建产物），驱动库从当前 harness 的配置与保险库为实例准备独立数据根——实例不向用户要任何凭据——并经实例自身的插件管理面链入被测插件。下一代装载带上插件后，其测试单元组件（带 `run(context)` 方法的 `@Component()` 类）就在真实壳里作为普通 Playwright 断言执行，驱动库随后移除插件并关壳。多个被测插件可共用一个壳实例，逐个装、逐个卸。实例的 PENGUIN_HOME 与浏览器数据放在仓库根的 `.data/penguin-testing-electron/`——入 .gitignore、跨测试轮保留的位置。

## 细节

- `testPlugin(options)` 跑完整生命周期：起壳、setup、链入、等装载带上插件的下一代、执行声明的单元、移除、关壳——并逐条报告每个单元的结果，一个单元失败不掩盖其余。
- 单元以模块到达：带 `run(context)` 方法的 `@Component`（或 `@Module`）类，与 harness 自身构件同一形态；类名即结果里的单元名。上下文携带的窗口句柄是标准 Playwright `Page`，单元内可原样使用全部 locator 与 `expect` 断言。
- 装入与移除走实例的 HTTP 管理面（与作者侧 `penguin plugin link` 同一动词）：被测插件目录原位引用，不打包不拷贝，装载由实例自己的代翻转完成。
- e2e 用例（e2e 组）起当前检出的壳、装入随用例携带的样例插件、跑它的两个单元、再移除；Linux 无 Xvfb 时用例带原因跳过，不假红。
