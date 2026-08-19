# 站点：博客图片迁往社区仓库

- **Date:** 2026-07-27
- **Type:** process
- **Scope:** `landing`
- **PR:** [#98](https://github.com/Prism-Shadow/penguin-harness/pull/98)

[English](2026-07-27-sites-and-blog.md)

博客图片是本仓库中唯一一类增长没有上限的资产。已发布文章的图片永远不会被删除，而每篇新文章又会再添几百 KB——这些字节只有营销站点会渲染，却要由每一个为构建产品而克隆仓库的人永久背负。它们现在与演示视频一样，迁到兄弟仓库 `Prism-Shadow/penguin-harness-community`，经 raw.githubusercontent 提供，带 `access-control-allow-origin: *` 与五分钟缓存；本仓库原先放在 `packages/landing/public/blog-assets/` 下的七个文件（六张文章配图加上生成的 `benchmark-light.svg`）已删除。所接受的代价是：GitHub 故障会使站点降级为图片缺失，这比那些字节要便宜。

## 文章正文未改动

Markdown 仍然写可移植的 `/blog-assets/<name>` 路径，无论是在 `![alt](…)` 图片中，还是在部分文章用于主题切换截图的原始 `<img src="…">` 标签中；由博客渲染器在渲染时把它解析为托管 URL——具体是 `src/lib/links.ts` 中的 `blogAssetUrl` 助手，加上 `src/pages/blog-post.tsx` 中的 `img` 适配器（等到它被调用时，rehype-raw 早已把原始标签转成了普通的 `img` 节点）。把改写放在那里而不是放进 Markdown，使托管位置只有一个事实来源：文章正文保持可读、可 diff，那些针对这些路径做断言的测试仍然断言路径，而再次搬家只需改一行，而不是把每篇文章扫一遍。其他所有图片来源——绝对 URL、GitHub 用户附件上传、站点资产如 `/og-cover.png`——都原样转发，并与改写本身一同由测试固定。

## 重新生成图片现在是两步流程

两个截图脚本改变了写入位置。`scripts/capture-blog-shots.mjs` 与 `scripts/render-benchmark-svg.mjs` 输出到被 gitignore 的暂存目录 `packages/landing/.blog-assets/`（按需创建，因为它在全新克隆中并不存在）；它们产出的文件随后被上传到社区仓库的 `blog-assets/` 目录，而文章正是从那里加载。README 的基准测试 SVG 不受影响——`assets/readme/benchmark-{light,dark}.svg` 仍由同一份落地页数据渲染，也仍然提交在本仓库中。
