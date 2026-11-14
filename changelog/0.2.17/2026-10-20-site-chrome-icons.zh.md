# 落地页与文档站不再打包应用的图标集

- **Date:** 2026-10-20
- **Type:** fix
- **Scope:** `ui`, `landing`, `docs`
- **PR:** [#1226](https://github.com/Prism-Shadow/penguin-harness/pull/1226)

[English](2026-10-20-site-chrome-icons.md)

公开站点的语言菜单原先用 Web App 的菜单勾选标记画勾，而这枚标记在每套主题的图标集里各画一遍，于是落地页与文档站的入口 chunk 带上了 Octicons、像素与双色调三套图标集，尽管站点顶栏只显示线性画法。现在菜单改画一枚只有线性画法的勾，形状与颜色不变，三套图标集随之移出两个入口 chunk。顶栏渲染逐像素不变：顶栏、语言菜单与手机菜单在浅色、深色及 1280、390 px 宽度下的截图，改动前后逐字节相同。

## 细节

- **`MenuRow`。** 两处标记都由调用方绘制的菜单行；`MenuItem` 即此行配上注册表字形与菜单勾。`ChoiceSlot` 是 `ChoiceCheck` 的固定槽位，内放调用方绘制的标记。
- **`CheckLineIcon`。** 菜单勾的单独线性画法，与 `CheckIcon` 共用同一笔画。
- **`SiteLanguageMenu`。** 各行改为配 `CheckLineIcon` 的 `MenuRow`，`site.css` 通过勾自己的类名 `site-ui-language-check` 上色。Web App 与组件画廊仍用 `MenuItem` 与完整图标集。
- **体积。** 入口 chunk，gzip 级别 6（括号内为 brotli 质量 11），对 `origin/main`（`172c9e4c4`）与本改动分别 `vite build`，2026-10-19 测得：落地页 507.5 → 473.6 KiB（402.0 → 374.5 KiB），文档站 930.9 → 896.9 KiB（685.5 → 658.0 KiB）。
