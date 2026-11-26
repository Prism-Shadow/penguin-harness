# 网站的插件页改为插件市场

- **Date:** 2026-11-17
- **Type:** feature
- **Scope:** `landing`
- **PR:** [#1583](https://github.com/Prism-Shadow/penguin-harness/pull/1583)

[English](2026-11-17-market-landing.md)

精选插件始终显示在搜索和筛选上方，直接打开分类链接也能看到。可以用左右箭头逐个浏览精选插件。目录可用排序旁的两个图标（网格与列表，悬停显示名称）在封面卡片与每个插件一行的紧凑列表之间切换，并记住选择的布局。

可以按分类筛选，按名称、更新时间或精选排序，并从两种布局打开同一插件的详情页。内置插件的封面随站点提供，其他图片来自社区仓库。

官网与应用从同一份官方插件目录读取数据，并为每个包选择同一版本。官网构建经 core 的 `@prismshadow/penguin-core/plugin-index` 使用与服务端相同的读取函数（[plugin-index-core](2026-11-19-plugin-index-core.zh.md)）。通过 GitHub 提供安装包的外部工作台可在详情页直接下载经目录固定的版本。目录刷新失败时，仍可浏览最近一次成功读取的内容。
