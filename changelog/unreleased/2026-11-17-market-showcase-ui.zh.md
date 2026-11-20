# 共享 UI 包新增插件市场的陈列模块

- **Date:** 2026-11-17
- **Type:** feature
- **Scope:** `ui`, `ui-gallery`
- **PR:** [#1582](https://github.com/Prism-Shadow/penguin-harness/pull/1582)

[English](2026-11-17-market-showcase-ui.md)

UI 包新增插件市场所用的一组模块，Web App 与公开站点共用：封面、封面卡片及其网格、精选轮播，以及产品页的各个部分。此次尚无页面使用它们，市场页面本身随后续改动上线。

## 细节

- `Cover` 绘制 16:9 的封面：有作者封面时按缩略图或原图显示；没有、或加载失败时，绘制缺省封面——以插件色相为底、带四种底纹之一，中间的图块上是插件图标，角上是产品标志（没有图标时图块上即产品标志）。图片到达之前，封面是该图主色的纯色底，不先画缺省封面。`coverHue` 与 `coverMotif` 按名称给出固定的色相与底纹。
- `CoverCard` 依次是封面、单行名称、固定占两行的描述，以及页脚：标签行占满一行，其下是事实与卡片操作。可选部分：`origin` 在名称下以淡色写出卡片来自哪台机器；`version` 是卡片右上角的版本标签；`bar` 是横贯卡片底部的一排文字操作，各栏按文字分宽，每个操作只有一行文字（卡片放不下全部文字时才以省略号截断较长的一个，从不折行），可带悬停说明与不可用状态。`ShowcaseGrid` 按自身宽度排入尽可能多的列，每列至少 14 rem（`--showcase-column-min`）；在手机宽度的单列里卡片横置，封面缩为文字旁的缩略图。列表布局中每张卡片是一个紧凑行：封面或图标块、名称与其下单行的描述，同一行末是操作条的各个操作，或标签与其下的事实，不显示版本标签；放得下两行时并排两行（`--showcase-list-min`：以操作条结尾的行 22 rem，以标签与事实结尾的行 34 rem），否则一列；只有在手机宽度的单列里，行末部分才移到该行之下。`CoverCardSkeleton` 是卡片的占位。
- `ShowcaseLayoutToggle` 是「卡片 / 列表」切换：两个扁平的图标按钮（网格，以及旁边带横线的方块），各以其布局命名并带悬停提示，当前一个为按下状态。设 `nativeTooltips` 时提示改用原生 title，供不挂载提示层的公开站点使用。图标注册表新增这两个图形 `layoutGrid` 与 `layoutList`，各套画法都有。
- `ShowcaseCarousel` 每次显示一页，下方是全部缩略图；设 `navigation="controls"` 时不显示缩略图栏，改为在控件旁写出当前页的位置（如「2 / 5」），且只挂载当前一页。每 7 秒换页；指针悬停或页面在后台时暂停，键盘焦点进入或点选缩略图后停止、直到按「继续轮播」；系统设置减少动态效果时不自动换页；「暂停 / 继续」按钮常在。`leadIndex` 与 `dayNumber` 按日期决定首屏。
- `ProductHero`、`ProductGallery`、`ProductSection`、`ProductParts`、`ProductPrompt`、`ProductColumns` 与 `ProductFacts` 组成产品页。
- 样式表只有一份 `showcase.css`，不引用任何一方的 Token。`theme.css` 把它放进 `ui-base` 层，并把其属性映射到各主题的 Token 与图标色；`site.css` 把它放进 `components` 层，并映射到站点自己的配色。全部模块同时从 `@prismshadow/penguin-ui` 与 `@prismshadow/penguin-ui/site` 导出。
- 新增样式钩子 `ui-showcase`，挂在 `Cover`、`CoverCard`、`ShowcaseCarousel` 与 `ProductHero` 上，各部分以 `data-part` 标出。内置主题暂未为它绘制样式。
- `ImageIcon` 新增 `size="fill"`，填满方形父元素。
- `StatusMark` 新增 `wordless`，用于容不下文字的行：只显示图形，文字移到悬停提示之首，并照常作为辅助技术读出的文本。
- 组件画廊新增「封面陈列」一板（每种色调配每种底纹、各种状态、卡片——其中有带版本标签与操作条的市场卡片、写明来源机器的卡片——用来示范列表行的四张市场卡片及其上方的布局切换，带缩略图栏与只有控件的两种轮播，以及产品页），「公开站点」板新增带布局切换的插件市场一组，徽标板新增一行只有图形的状态标记，钩子板新增该钩子的说明。画廊上的浏览器检查确保操作条的每个操作只占一行、列表行的操作与名称同在一行。
