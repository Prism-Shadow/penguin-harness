# 工作台页面经 Token 契约跟随应用主题

- **Date:** 2026-10-26
- **Type:** feature
- **Scope:** `web`
- **PR:** [#1346](https://github.com/Prism-Shadow/penguin-harness/pull/1346)

[English](2026-10-26-workbench-theme-tokens.md)

Web App 把解析后的整套主题复制进工作台页面所在的 frame（此前只复制灰阶、强调色与字体栈），`/workbench-ui.css` 把工作台的变量映射到这些值上。使用这些变量的页面在任何主题下都取用该主题的表面、线条、圆角、字体与状态色调。

## 细节

- frame 的根元素得到 `light` / `dark` 类、`data-theme`（总是写出，`github` 也写）、`data-accent`（仅当前主题确实绘制该预设时）、`data-font-latin` / `data-font-cjk`、根字号，以及 UI 包 Token 契约中每个 `--ui-*` 的解析值。应用的 `@font-face` 规则以绝对 URL 复制进 frame 的 head，主题自带的字体在页面里同样能加载。切换主题、明暗、强调色、字号或字体，以及页面每次加载时，都会重新复制。
- 所有 `--wb-*` 变量与 `wb-*` 类保留不变，改为映射到 Token：`--wb-bg` → `--ui-canvas`、`--wb-surface` → `--ui-surface-muted`、`--wb-fg` → `--ui-fg`、`--wb-muted` → `--ui-fg-muted`、`--wb-border` → `--ui-line`、`--wb-hover` → `--ui-fill-neutral`、`--wb-accent` / `--wb-accent-fg` → `--ui-accent` / `--ui-accent-fg`、`--wb-radius` → `--ui-radius-md`、`--wb-font` → `--ui-font-ui`、`--wb-mono` → `--ui-font-mono`。正文与代码改用主题的正文与代码字号。
- 新增：`success`、`attention`、`danger`、`done`、`neutral`、`info` 六种语义色调各自的 `--wb-tone-<tone>-fg`、`-bg`、`-line`，以及标签胶囊 `.wb-badge`，由 `data-tone` 选择色调（缺省为 `neutral`）。
- 在应用之外直接打开的页面回落到 Primer 的取值，明暗随浏览者的系统偏好。
