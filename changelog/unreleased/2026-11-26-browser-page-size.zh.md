# Agent 浏览器可以设置页面尺寸，页面真实改变

- **Date:** 2026-11-26
- **Type:** feature
- **Scope:** `browser-automation`, `browser-extension`, `cli`, `web`
- **PR:** [#1923](https://github.com/Prism-Shadow/penguin-harness/pull/1923)

[English](2026-11-26-browser-page-size.md)

用户与 Agent 现在都可以给 Agent 浏览器的标签页设一个固定的页面尺寸，页面真的按这个尺寸排版，而不只是为截图做一次模拟。

## 细节

- `penguin browser resize <w>x<h> [--scale <n>]` 给标签页设固定页面尺寸，宽高各为 200 到 4096 CSS 像素，可选的设备像素比为 1 到 4。`penguin browser resize --fit` 恢复为适应浏览器面板，`penguin browser resize` 不带参数时显示页面报告的尺寸。命令在页面报告新尺寸后才返回，紧接着的截图即为该尺寸。路由为 `POST /api/builtin-browser/tabs/:tab/viewport`。
- 内置浏览器里，页面的 `<webview>` 无论在屏幕上还是停放时都按固定尺寸排版，再整体缩小放进浏览器面板并居中，不放大。像素比是唯一的设备参数覆盖。
- 浏览器面板的工具行新增「页面尺寸」按钮，菜单为「适应面板」、1280 × 800、1440 × 900、1920 × 1080 与「自定义尺寸…」，tooltip 给出尺寸与显示时的缩放比例。固定尺寸生效时，按钮显示为强调色。
- 用户自己的 Chrome 里，扩展把标签页移到一个专属的窗口并把该窗口调到页面尺寸，从不移动用户的其他窗口，也不改其尺寸。Chrome 给不出这个尺寸或扩展版本过旧时，改为在 Agent 操作期间模拟该尺寸。
- 尺寸属于标签页，跳转后保留，页面弹出的标签页沿用来源标签页的尺寸。尺寸只保存在内存中，服务端重启后标签页恢复为适应面板。
- browser-automation Skill 改用 `resize`，不再用 `cdp Emulation.*`，`cdp` 命令仍然可用。
