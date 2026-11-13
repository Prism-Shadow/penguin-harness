# UI 画廊在自定义背景上截图并检查应用

- **Date:** 2026-10-19
- **Type:** process
- **Scope:** `ui-gallery`
- **PR:** [#1230](https://github.com/Prism-Shadow/penguin-harness/pull/1230)

[English](2026-10-19-gallery-wallpaper-shots.md)

UI 画廊嵌入的应用可以带着自定义背景启动，也可以显示对话会出现的通知。截图脚本与一份新的浏览器测试借此覆盖自定义背景上的消息填充（[#1220](https://github.com/Prism-Shadow/penguin-harness/pull/1220)）与强调色淡底（[#1223](https://github.com/Prism-Shadow/penguin-harness/pull/1223)）。

## 细节

- 嵌入的应用（`app.html`）新增两个可选 URL 参数。`wallpaper=<data URL>`（可附 `wallpaperSettings=<JSON>`）在应用启动前写入自定义背景的存储键，与保存过背景的浏览器所存的一致。`notices=1` 在演示数据中显示初始密码横幅与上下文窗口通知。画廊自己的页面两者都不设，其框架不变。
- `scripts/shots.mjs` 新增 `--accents <list>`（取代 `--accent`，后者仍可用）、`--wallpaper off|on|both`、`--transparency`（默认 25）与 `--notices on|off`。指定 `--accents` 或 `--wallpaper` 时，每种强调色与背景状态各写入自己的目录 `<theme>/<mode>/<lang>/<accent>/wallpaper-<off|on>/`；不指定时保持原有的平铺布局。背景图是一张生成的小 JPEG，由强烈、浅色与深色的斜条纹组成。
- 新的浏览器测试 `e2e/wallpaper-fills.spec.mjs` 在八个用例中检查计算样式：每个主题下背景上的用户气泡半透明，各主题下的通知与审批条，无背景时的不透明淡底，预设强调色在浅色中的色相，减少透明度，以及白领下保持不透明的 Toast。
