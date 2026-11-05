# 第四套主题：手绘风格的卡通

- **Date:** 2026-11-04
- **Type:** feature
- **Scope:** `ui`, `web`, `ui-gallery`
- **PR:** [#1473](https://github.com/Prism-Shadow/penguin-harness/pull/1473)

[English](2026-11-04-theme-cartoon.md)

设置 › 外观与画廊的主题切换新增第四套主题卡通（Doodle，id `cartoon`）：纸面与墨线、平涂实色，每个框的边都是一笔手绘线，浅色与深色（深色纸上的粉笔）两种明暗。

## 细节

- 手绘线是每种尺寸一圈按固定种子预先画好的圆角矩形（`packages/ui/scripts/draw-doodle-edges.mjs`），以 CSS `border-image` 九宫格贴在框的边上。有底色或描边的按钮、文本输入框、选择框与本人的消息气泡经新的样式钩子 `ui-edge` 取得它，卡片、代码块、对话框、菜单、弹出层、提示、输入区、通知与小组件经各自已有的钩子取得它。线条从不画在文字上，悬停与重渲染都不改变形状，强制色彩模式下回到普通边框。其余三套主题对 `ui-edge` 为空操作。
- 字体：拉丁为 Shantell Sans（`@fontsource-variable/shantell-sans`，SIL OFL 1.1），中文为霞鹜文楷 GB 屏幕阅读版 1.530（SIL OFL 1.1）。文楷只打包其网页版中覆盖 GB2312 字符表全部字符的 48 个分片（2.8 MB），由 `packages/ui/scripts/vendor-wenkai.mjs` 从锁定版本的 `lxgw-wenkai-screen-web` 包中原样取出；更罕用的字回退到 Noto Sans SC。两种字体都随许可全文列入版权信息。
- 强调色：主题自带的强调色与其他主题一样为黑白；强调色选择新增五个画笔预设（马克笔橙、圆珠笔蓝、草绿、蜡笔红、葡萄紫）。
- 当前版本不认识的主题 id（例如较新的版本经账号同步写入的）仍按缺省主题显示，存储值保持原样。
- 新增五个区块钩子，主题可以按区块整体打扮：`ui-start`（新建对话的首页）、`ui-library`（模型库的分组与卡片）、`ui-ledger`（用量汇总卡、公司指标块、Benchmark 卡片的分数）、`ui-empty`（空状态）与 `ui-run`（对话工具栏的运行指示，现为 `RunStatus`）。标签、复选框与单选框加入 `ui-edge`；加载标记与空状态插图在每种画法下各画一份，由主题显示自己的；统计图的填充纹样与滤镜（`ChartDefs`）每页定义一次；统计图的填充标记从自身颜色取填充。当前对话在侧栏的那一行对辅助技术标为当前页。朴素、白领与极客三套主题的外观不变。
