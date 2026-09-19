# 共享 UI 包、令牌契约，以及接入 Web App 的默认主题

- **Date:** 2026-09-16
- **Type:** refactor
- **Scope:** `ui`, `web`, `ci`
- **PR:** [#765](https://github.com/Prism-Shadow/penguin-harness/pull/765)

[English](2026-09-16-penguin-ui-token-contract.md)

主题系统的第一步。新增私有、源码直引的包 `@prismshadow/penguin-ui`（`packages/ui`），把 Web App 的
颜色、圆角、阴影、字体以及焦点环与滚动条规则收拢为一组具名设计令牌；现有外观原值原样成为它的默认主题
`github`：像素比对覆盖的 12 个页面在明暗两种模式、中英两种语言下渲染完全一致，字体栈有变的唯一一条规则
`.font-sans` 见下文。唯一有意的可见变化在首次加载：已存的明暗模式、强调色与字号在首帧之前就已套用，
深色页面在脚本加载期间不再闪白，首帧也不再先以 16px 渲染、再重排到默认的 18px。

## 细节

- `tokens.ts` 承载契约：15 组共 186 个 `--ui-*` 名称（表面、文字、线条、强调色、六个语义色调 × 五部分
  ——含新增的 `done` 与 `info`、图表、代码与差异、形状、层次与磨砂、字体族、字号与标题层级、密度、动效、
  图标、焦点/选区/滚动条），以及主题 id `github` / `modern` / `geek`。
- `theme.css` 声明 `dark` 变体、排在 Tailwind 自身之后的两个级联层（先 `ui-theme` 后 `ui-accent`，
  强调色预设因此总能压过主题的深色块）、把令牌暴露为工具类（`bg-surface`、`text-fg-muted`、
  `border-line`、`bg-accent`、`text-tone-danger-fg` 等）并把 Tailwind 的字体、圆角与阴影刻度改指令牌的
  桥接、读取令牌的基础规则，以及五个强调色预设。
- `.font-sans` 改读应用自身的无衬线字体栈（`--ui-font-sans`），不再是 Tailwind 缺省的
  `ui-sans-serif, system-ui, sans-serif, …`。用到该类的只有一处，即「用 AI 创建」对话框里折叠的
  完整提示词预览：拉丁文字体不变（两个字体栈的第二项都是 `system-ui`），中文改经具名的 PingFang SC /
  Microsoft YaHei 解析、不再落到系统回退字体，多数系统上是同一字体，Windows 上则不能保证。
- `themes/github.css` 以应用现有取值定义每个令牌，并用一段灰阶桥接改指 Tailwind 的
  `--color-gray-*` 与 `--color-white`，现有灰阶类无需改动组件即随主题变化。它的基础规则定义全部令牌，
  深色规则只写深色下取值不同的令牌，与明暗无关的组（形状、字号、密度、动效、图标）只写一次。
  `themes/modern.css` 与 `themes/geek.css` 以空占位文件加入。
- `boot.ts` 生成现已内联进 `packages/web/index.html` 的首帧前脚本，以及主题 Provider 用来同步的
  `applyThemeAttributes()`。深色 `theme-color` 改为页面真实的深色背景 `#000000`。
- 主题 Provider 新增一个存储的主题 id（`penguin.themeId`，缺省 `github`），以 `html[data-theme]`
  套用；尚无设置项暴露它。该键在数据根清扫中归为浏览器偏好。
- Web App 以 `workspace:*` 依赖该包，pnpm 将其链接到 `packages/ui`，Vite、vitest 与 tsc 因而按包的
  `exports` 直接读取包的源码，Tailwind 也扫描包的源码。`styles.css` 删去了改由包负责的规则。
- 原先写 `var(--accent-bg)` / `var(--accent-fg)` 的调用处改为 `bg-accent`、`border-accent`、
  `ring-accent` 与 `text-accent-fg`，三处 `bg-black/45` 对话框遮罩改读 `--ui-overlay-backdrop` 令牌。
  `--accent-bg` / `--accent-fg` 作为别名再保留一个波次。
- `packages/web/scripts/theme-shots.mjs` 针对同一服务端、同一份数据与冻结的时钟，从任意多个 Web 构建
  截取 12 个页面 × 浅色/深色 × 中/英，并逐像素比对截图目录。
- CI 的 `web-cli` 分片运行新包的测试；`packages/core/src/internal/ports.ts` 的端口表为组件画廊的开发
  服务器预留 7372。
