# 第四套主题「卡通」（Doodle）：手写的白领

- **Date:** 2026-11-10
- **Type:** feat
- **Scope:** `ui`, `web`, `ui-gallery`
- **PR:** [#1531](https://github.com/Prism-Shadow/penguin-harness/pull/1531)

[English](2026-11-10-theme-doodle.md)

设置 → 外观新增第四套主题「卡通」（Doodle，`doodle`），排在白领、极客、朴素之后。它是第一个以白领为基准的主题包：页面沿用白领的布局、间距、动效、无框的活动行与分组底色的设置行，卡通只换纸、字与笔。

## 外观

- **纸与墨。** 暖色纸张配色——纸面 `#f6f1e7`、其上的纸条 `#fcf9f2`、更深一档的垫纸；深色为 `#1c1a17` 的深色纸配粉笔色墨——灰阶也换成暖色，应用里的调色类同样落在纸上。主题自己的强调色就是墨色；圆珠笔蓝只留给链接、焦点环与选区。五个强调色预设：马克笔橙、圆珠笔蓝、草绿、蜡笔红、葡萄紫。
- **手写字。** 界面与正文用 Shantell Sans，汉字用霞鹜文楷 GB 屏幕阅读版（LXGW WenKai GB Screen），代码用 JetBrains Mono；16px 根字号下正文 14px，标题用粗体。
- **笔线只画在手碰到的地方。** 有底色或描边的按钮、输入框、选择框、复选框、单选框、开关轨道、首页的 Agent 与 Workspace 选择器，以及本人的消息气泡，都描一道固定种子的笔线，底色裁到笔线内。获得焦点的输入框改用圆珠笔蓝重描；获得焦点的按钮在笔线外显示焦点环。浮层——对话框、菜单、弹出框、提示、输入区与弹出通知——是一张纸条，笔线与柔和投影画在同一张图里。卡片、工具卡、代码块、指标块、提示条、小部件与表格保留白领的细线或无线。
- **两处小画。** 加载圈是一笔铅笔涂鸦；页面级空状态在标题上方显示一个小涂鸦。
- 强制颜色模式下笔线全部撤去，各宿主恢复自己的边框、底色与焦点环。

## 主题包

- `packages/ui/src/themes/doodle/`：`pack.json`（`base: "modern"`）、只声明卡通所改分组的 `tokens.css`（配色、字体、形状、层次、窗口栏的颜色、图标色相、焦点环）、`recipes.css`、`accents.css`、`fonts.css` 与 `index.css`。注册表、三份入口样式表、`fonts/index.css` 与 Web App 的词典都已列入；画廊的主题包切换与 Foundations 的主题包表读它的清单。
- `scripts/draw-doodle-edges.mjs` 以固定种子画出笔线——控件、气泡、胶囊、方框与圆球五种形状的 `border-image` 笔画与对应的 `clip-path: shape()` 裁切，以及纸条的玻璃图——写入 `recipes.css` 的生成区块（`--check` 报告过期的区块）。`scripts/raster-strokes.mjs` 把页面上成批出现的形状渲染成小 PNG。

## 钩子

- `ui-edge`：人按下、输入或写下的框的边。宿主：`Button`（幽灵与链接按钮除外）、`Input`、`Textarea`、`Select`、`OptionMenu`、`SearchInput`、`FormPickerTrigger`、`Checkbox`、`CheckboxBox`、`Radio`、`RadioDisc`、`Switch`、`MessageBubble`、`AgentSelect` 与 `WorkspaceSelect`。
- 五个分区钩子，作为与主题无关的结构标注；内置主题包中目前只有卡通的空状态插画用到：`ui-start`（首页）、`ui-library`（模型库）、`ui-ledger`（用量汇总卡、`StatTile`、Benchmark 卡片的分数）、`ui-empty`（`EmptyState`，插画位同时画有线性图与涂鸦）与 `ui-run`（对话工具栏的运行指示，现为 `RunStatus`）。
- 加载圈同时画弧线与涂鸦，theme.css 默认显示弧线，直到主题包另行指定。有填充的统计图标记以 `--_paint` 携带颜色，图例色块是 `swatch` 部件，Token 种类的标记标明其序列。侧栏中当前打开的对话行标注 `aria-current="page"`。

## 字体

Shantell Sans 经 `@fontsource-variable/shantell-sans` 引入，与应用共用的字体一起声明在 `fonts/shantell-sans.css`。霞鹜文楷 GB 屏幕阅读版 1.530 由 `scripts/vendor-wenkai.mjs` 从其网页发行包中取出覆盖 GB2312 字符集的 48 个切片（2.8 MB）放入主题包的 `fonts/`，其 `@font-face` 写成主题包的 `fonts.css`，并锁定发行包的完整性校验值；`vendored-fonts.json` 列出了它。卡通因此能导出成导入可接受的主题包：它的 `fonts.css` 只引用自己的 `fonts/*.woff2`。两种字体的许可证都随 `fonts/LICENSES/` 发布，并出现在致谢页。

## 守护

- 干净规则会展开配方的私有自定义属性，经 `var(--_…)` 铺设的图像或形状按展开后的值判断；控件边、弹出通知、首页品牌区与空状态插画位加入 R1 的落脚处，控件边加入 R8 的框类宿主。卡通没有任何命中。
- 契约测试把以白领为基准的主题包按白领的值解析；新增的卡通测试要求其配方只读取两种模式下都已声明的图形、全部位于 `forced-colors: none` 之内且不使用滤镜；钩子守护认得六个新钩子。
