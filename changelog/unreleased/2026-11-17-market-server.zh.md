# 服务端读取插件市场的编排并提供其图片

- **Date:** 2026-11-17
- **Type:** feature
- **Scope:** `server`, `core`, `landing`, `docs`
- **PR:** [#1580](https://github.com/Prism-Shadow/penguin-harness/pull/1580)

[English](2026-11-17-market-server.md)

插件市场的编排写在一份文档里，即社区仓库的 `assets/plugins/market.json`（schema 1）：维护者精选了
哪些插件、其中哪些可作市场轮播的首屏，以及有配图的插件的封面、位图图标与截图；按 npm 包名索引，
每张图片是文档旁的一个路径。服务端现在读取它并交给 Web App：

- `GET /api/plugins/market`（任何已登录用户）返回 `{hero, selected, art, source}`。`art` 给出插件
  的 `cover`（`url`、`thumbUrl`、`tone`）、`icon` 与 `screenshots`（附中英文说明），每个 URL 都是
  本服务端自己的路由。文档不携带任何计数、排名或评分。
- 与插件索引一样有两个来源：内置在服务端的副本（`packages/server/src/plugin/builtin-market.json`，
  每次发版时从社区仓库更新）与已发布的文档。后者经部署的镜像规则（`PENGUIN_PLUGIN_PROXY`）抓取，
  复用 30 分钟，刷新期间继续提供旧的一份，热更新时随之保留。已发布的文档一旦应答即取代内置副本；
  列表最多为首次抓取等待 1.5 秒。`source` 写明由哪一份应答（`embedded` 或 `published`）。违反
  schema 1 任一规则或 `schema` 不同的文档不会被使用，内置副本继续生效。`PENGUIN_PLUGIN_MARKET=off`
  只读内置副本、不发起任何出网请求；填其他值则替换文档的 URL。
- `GET /api/plugins/market/asset?path=…&rev=…` 提供当前文档列出的一张图片，其他路径一律返回 404 且
  不发起抓取。服务端经同样的镜像规则从文档旁抓取图片（每个地址 15 秒，至多 2 MB，同时至多四个抓取，
  同一张图片同时只有一个），字节须为 WebP、PNG 或 JPEG 才会提供，并保存在
  `<data root>/.cache/plugin-market/` 下，一天后按 ETag 重新校验，源不可达时从这里提供。取不到的图片
  返回 404，页面随之改用自己绘制的封面。
- 应用中心的快捷方式会写明安装其 Workbench 的插件库插件（`plugin`，取自文件夹里的 `.plugin.json`
  回执）；手写的 Workbench 不写。
- 插件库新增分类 `learning-life`（学习与生活 / Learning & Life），排在沙箱后端之前；公开站点的插件
  列表为它排序并配色。

## 数据根目录

`<data root>/.cache/plugin-market/` 是新增目录，只存放抓取来的图片，每张一对文件。以点开头的名字
不可能是任何 Project 的 id，所以它不占用 Project 名，也不会落进某个 Project 的目录。它是缓存：不会被
任何导出或备份带走，删除它只会让每张图片重新抓取一次。
