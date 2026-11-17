# 共享 UI 包新增插件市场的陈列模块

- **Date:** 2026-11-17
- **Type:** feature
- **Scope:** `ui`, `ui-gallery`
- **PR:** [#1582](https://github.com/Prism-Shadow/penguin-harness/pull/1582)

[English](2026-11-17-market-showcase-ui.md)

UI 包新增插件市场所用的一组模块，Web App 与公开站点共用：封面、封面卡片及其网格、精选轮播、网格旁的榜单，以及产品页的各个部分。此次尚无页面使用它们，市场页面本身随后续改动上线。

## 细节

- `Cover` 绘制 16:9 的封面：有作者封面时按缩略图或原图显示；没有、或加载失败时，绘制缺省封面——以插件色相为底、带四种底纹之一，中间的图块上是插件图标，角上是产品标志（没有图标时图块上即产品标志）。图片到达之前，封面是该图主色的纯色底，不先画缺省封面。`coverHue` 与 `coverMotif` 按名称给出固定的色相与底纹。
- `CoverCard` 依次是封面、单行名称、固定占两行的描述，以及页脚：标签行占满一行，其下是事实与卡片操作。`ShowcaseGrid` 按自身宽度排入尽可能多的 17 rem 列；在手机宽度的单列里卡片横置，封面缩为文字旁的缩略图。`CoverCardSkeleton` 是卡片的占位。
- `ShowcaseCarousel` 每次显示一页，下方是全部缩略图。每 7 秒换页；指针悬停或页面在后台时暂停，键盘焦点进入或点选缩略图后停止、直到按「继续轮播」；系统设置减少动态效果时不自动换页；「暂停 / 继续」按钮常在。`leadIndex` 与 `dayNumber` 按日期决定首屏。
- `ShowcaseRanking` 列出至多十行带名次的条目——名次、封面缩略图、名称、标签与该榜排序所依的数字——几个榜以标签页切换（方向键、Home 与 End 可在其间移动）；前三名的名次在着色的底上，缩写的数字在悬停时与读屏中给出全称。点开任一行即打开该条目。可选的 `note` 以淡色小字立在标题行末，其 `noteHint` 在悬停时与读屏中给出（插件市场的数字还是占位数据时写「示例数据」）；`hints="title"` 让面板的悬停提示改用浏览器自带的提示，供没有提示层的宿主——公开站点——使用。`ShowcaseSplit` 在容得下两列卡片与榜单时把它放在网格右侧一栏，否则放到网格下方。
- `ProductHero`、`ProductGallery`、`ProductSection`、`ProductParts`、`ProductPrompt`、`ProductColumns` 与 `ProductFacts` 组成产品页。
- 样式表只有一份 `showcase.css`，不引用任何一方的 Token。`theme.css` 把它放进 `ui-base` 层，并把其属性映射到各主题的 Token 与图标色；`site.css` 把它放进 `components` 层，并映射到站点自己的配色。全部模块同时从 `@prismshadow/penguin-ui` 与 `@prismshadow/penguin-ui/site` 导出。
- 新增样式钩子 `ui-showcase`，挂在 `Cover`、`CoverCard`、`ShowcaseCarousel`、`ProductHero` 与 `ShowcaseRanking` 上，各部分以 `data-part` 标出。内置主题暂未为它绘制样式。
- `ImageIcon` 新增 `size="fill"`，填满方形父元素。
- 组件画廊新增「封面陈列」一板（每种色调配每种底纹、各种状态、卡片、轮播、带与不带说明的榜单，以及产品页），「公开站点」板新增插件市场一组，钩子板新增该钩子的说明。

- 封面卡片可切换成单列紧凑列表，操作和详情入口都保留。
