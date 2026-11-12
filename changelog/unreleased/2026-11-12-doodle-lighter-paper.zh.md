# 卡通主题的浅色纸调亮

- **Date:** 2026-11-12
- **Type:** fix
- **Scope:** `ui`
- **PR:** [#1541](https://github.com/Prism-Shadow/penguin-harness/pull/1541)

[English](2026-11-12-doodle-lighter-paper.md)

卡通（Doodle）主题包的浅色模式从米色纸换成更亮的暖白纸，页面不再显得发暗。墨色、笔线、胶囊与各色调均不变；深色模式不变。

## 细节

- 画布 `--ui-canvas` 由 `#f6f1e7` 改为 `#fbf9f4`，便笺 `--ui-surface` 由 `#fcf9f2` 改为 `#fefdf9`，垫纸 `--ui-surface-muted`（侧栏与桌面端标题带）由 `#f3ede3` 改为 `#f6f3ec`；由它们派生的表面随之调整：`--ui-inset` `#f7f4ee`、`--ui-fill-neutral` `#ede7db`、`--ui-overlay` `#fffefb`、`--ui-code-bg` `#f5f1e8`，以及灰阶桥接的 50 与 100 两级。主题包清单的浅色色样随新纸色更新。
- 正文在每种纸面上都满足 WCAG AA：正文墨色不低于 12.3:1，次级文字不低于 5.9:1，弱化文字在垫纸上为 4.6:1，在画布与便笺上更高。
- 浮起纸条（对话框、菜单、弹出层、Toast、输入区）的预绘贴图由 `scripts/draw-doodle-edges.mjs` 按新的浮层底色重画。
