# 按 Session 隔离浏览器页面，按 Project 隔离登录状态

- **Date:** 2026-10-13
- **Type:** fix
- **Scope:** `desktop`, `server`, `web`, `ui-gallery`, `docs`
- **PR:** [#1105](https://github.com/Prism-Shadow/penguin-harness/pull/1105)
- **Breaking:** yes — 各 Project 使用独立的浏览器存储，需要重新登录网站。

[English](2026-10-13-browser-session-isolation.md)

修复了桌面浏览器在不同 Session 中显示同一组页面、自动化操作共用活动标签页的问题。

## 细节

- 每个 Session 保留自己的标签页和活动页面。浏览器自动化仅列出和操作该 Session 的页面，拒绝其他 Session 的标签 ID，并从脚本结果中排除其他 Session 同时打开的页面。
- 弹窗继承来源页面的 Session。草稿中的页面在创建 Session 后随之转移，无需重新加载；后台页面保持挂载，播放可以继续。
- 同一 Project 内的 Session 共用 Cookie、登录状态和网站存储。不同 Project 使用独立的持久化浏览器配置，Cookie 导入和网站数据清理也按 Project 分开执行。
- UI Gallery 对 Session 页面转交请求返回浏览器不可用，与其他浏览器操作保持一致。

## 兼容性

需要更新包含原生外壳的桌面应用，并在每个 Project 中重新登录或单独导入 Cookie。旧的全局浏览器数据保留在 Project 配置之外，不会自动复制到各 Project。浏览历史仍由整个内置浏览器共用。
