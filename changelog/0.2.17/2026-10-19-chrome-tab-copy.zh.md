# Chrome 扩展不再暗示你的 Cookie 不会被使用

- **Date:** 2026-10-19
- **Type:** fix
- **Scope:** `browser-extension`, `docs`
- **PR:** [#1213](https://github.com/Prism-Shadow/penguin-harness/pull/1213)

[English](2026-10-19-chrome-tab-copy.md)

扩展的配对页原先写着 Chrome 的 Cookie 存储不会被触及，读起来像是 Agent 操作的标签页不带你的登录状态。现在改为：这些标签页沿用你的登录状态，但 Agent 看不到你的其他标签页和浏览历史，也不能直接读取或修改 Chrome 的 Cookie。文档「使用你自己的 Chrome」一节对同一限制的表述随之统一。

## 细节

- 中文界面里，扩展的简介、配对页和弹窗，以及浏览器文档页，描述 Agent 在标签页里做的事时一律用「操作」，不再用「驱动」。小标题「在命令行中驱动」改为「在命令行中操作」，锚点随之改变。
