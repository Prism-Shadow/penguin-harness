# Chrome 扩展：换上官网的样式，语言与主题跟随设备

- **Date:** 2026-10-13
- **Type:** feature
- **Scope:** `browser-extension`, `docs`
- **PR:** [#1091](https://github.com/Prism-Shadow/penguin-harness/pull/1091)

[English](2026-10-13-extension-site-style.md)

PenguinHarness Browser 扩展的选项页与工具栏弹窗换上了 penguin.ooo 的样式；语言和亮暗色在用户自行选择之前跟随设备。

## 细节

- 两个页面都有了与官网一致的顶栏：左侧是官网徽标与产品名，右侧是语言开关和主题开关。配色取自官网：中性灰，链接与工具栏角标用同一种品牌蓝，主按钮为近黑色（深色主题下为浅灰），圆角 8px。各段仍以分隔线划分，不加卡片框。
- 未作选择时，页面与工具栏提示文字使用 Chrome 的界面语言：`zh-*` 为中文，其余为英文。此前无论浏览器是什么语言都显示英文。
- 语言开关提供 English、中文与「跟随系统」；主题开关与官网一样依次切换浅色、深色与「跟随系统」。选「跟随系统」时，页面随设备的亮暗设置实时切换。
- 选择记在 `chrome.storage.local`（`uiLanguage` 新增 `system` 取值，另有新键 `uiTheme`），扩展已打开的所有页面立即随之更新。用旧开关选过的 English 或中文保持不变。
- manifest 的名称与说明仍来自 `_locales`，由 Chrome 按自身语言选取。
- 文档的内置浏览器页面同步改写了默认行为与两个开关的说明。
