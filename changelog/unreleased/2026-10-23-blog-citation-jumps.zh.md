# 博客文章内的跳转准确落到目标处，且留在本页

- **Date:** 2026-10-23
- **Type:** fix
- **Scope:** `landing`
- **PR:** [#1302](https://github.com/Prism-Shadow/penguin-harness/pull/1302)

[English](2026-10-23-blog-citation-jumps.md)

在博客文章中点击引用，现在即使文中图片仍在加载，Chromium、Firefox 与 WebKit 也都会把对应的参考资料条目带到视野中；图片陆续到达时，正文也不再在读者眼前移动。此前文章里的图片在加载完成前不占任何空间，每加载完一张，下方的全部内容就被推下去。在滚动到引用条目的途中，Chromium 与 Firefox 会因此停在条目上方一张图片乃至更多的高度处，WebKit（Safari）则直接放弃滚动，读者停在原地。回跳链接与目录条目同样如此。从指向文章锚点的链接（`…/blog/<post>#fn-3`、`#fnref-3-2` 或某个标题）打开文章时，落点现在也与在页内点击一致：条目或引用以浅色底标出，停在导航栏下方，不再高出约 15 px。

## 细节

- 文章中以 Markdown 图片形式出现的每张图片，宽高都记录在 `packages/landing/src/lib/blog-image-sizes.json` 中。页面给每个 `<img>` 加上这两个属性，图片到达之前就按正确比例占好位置。`packages/landing` 下的 `node scripts/blog-image-sizes.mjs` 会补记尚未记录的图片（每张下载一次，读取文件头）；若文章用到的图片没有记录尺寸，landing 测试会失败。原始 `<img>` 标签保留其自带的 `width` 与 `height`。
- 从锚点链接打开的文章加载完毕、上浮动画结束后，页面请浏览器在原地重新跳转到该锚点。历史记录不新增条目，按「后退」仍会离开文章。
- 文章内的所有跳转都留在本页：以路径或 `penguin.ooo` 地址写成、指向同一篇文章某个片段的链接（`/blog/<post>#fn-1`），现在渲染为单纯的 `#fn-1`；此前它像站内其他页面一样会在新标签页打开。
- `packages/landing` 下的 `node scripts/check-post-jumps.mjs` 在 Chromium、Firefox 与 WebKit 中检查构建好的站点。检查时开启平滑滚动，图片按记录的尺寸延迟到达；脚本逐个点击每篇带引用文章的引用、回跳链接与目录条目，并在滚动停止后测量每个目标的落点。
- 引用的写法不变，标记与 id 沿用 [#1252](https://github.com/Prism-Shadow/penguin-harness/pull/1252)。文章新增 Markdown 图片时，需要补记它的尺寸。
