# 组件画廊上线公开站点，导航排在「文档」之后

- **Date:** 2026-10-11
- **Type:** feature
- **Scope:** `landing`, `docs`, `ui-gallery`, `web`, `ci`
- **PR:** [#1044](https://github.com/Prism-Shadow/penguin-harness/pull/1044)

[English](2026-10-11-landing-gallery.md)

组件画廊（`packages/ui-gallery`）发布到公开站点的 `/gallery/`：真实的 Web App 及其组件，对接浏览器内的演示接口，背后没有服务端。落地页与文档站的顶部导航在「文档」之后链接到它。

## 细节

- `pnpm build:site` 以 `BASE_PATH=<base>gallery/` 构建画廊，并像把文档复制到 `docs/` 那样把它复制到 `gallery/` 下；Web App 源码从 dist 导入 core 与 amsp，二者先行构建。画廊构建时在每个页面的地址（`s/<界面>/`、`c/<条目>/`、`fonts/…`）写一份文档副本，刷新或打开转发的链接都能直达该页。sitemap 列出 `/gallery/`。
- 「画廊」（英文界面为 Gallery）排在「文档」之后，出现在落地页导航（桌面一行与手机菜单）、文档站导航以及落地页页脚的「资源」一栏。它与「文档」一样是指向兄弟站点的普通链接，从不标为当前页，并共用滑动悬停底块；链接带上读者当前浏览站点所用的语言（`?lang=zh` 或 `?lang=en`），画廊以该语言打开，而不是用它自己的缺省语言。落到落地页 404 页面的 `/gallery/…` 未命中地址转到画廊首页，与 `/docs/…` 的未命中地址转到文档首页一致。
- 在公开站点上，画廊的品牌标志链接回站点首页；旁边的「首页」仍打开画廊自己的首页。
- Web App 的品牌标志按构建的 base 取地址，画廊里的那份因此落在 `/gallery/` 之下；应用本身的地址不变。
- 落地页与文档站的 favicon 改为根绝对 URL：博客文章与文档页地址上的文档副本此前在自身路径下请求它，得到 404。站点构建在某站的 HTML 以相对 URL 引用资源，或其 HTML、CSS、脚本指向该站 base 之外时失败。
- `pages.yml` 在推送到 main 且改动 Web App 或 UI 包时也会部署，公开的画廊随应用更新。只改这两个包的 pull request 不在此构建，因为 CI 的完整构建已经编译了画廊。
