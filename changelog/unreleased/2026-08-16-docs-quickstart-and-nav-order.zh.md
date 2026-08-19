# 文档：Quickstart 按安装路线分出子页，使用指南排到设计章节之前

- **Date:** 2026-08-16
- **Type:** process
- **Scope:** `docs`
- **PR:** [#303](https://github.com/Prism-Shadow/penguin-harness/pull/303)

[English](2026-08-16-docs-quickstart-and-nav-order.md)

Installation 页并入了 Quickstart，Quickstart 变成一个总览页，按安装路线各分出一个子页；侧边栏为此多了一层嵌套，使用指南也移到了核心设计章节之前。

## 细节

- Quickstart 变为一张三行的路线表（桌面应用 / 命令行与 Web 应用 / SDK——各自面向谁，以及是否涉及终端）、三条路线共通的部分，以及唯一那项共同前置要求。此后每条路线由自己的页面带读者走到第一个 Task：`quickstart-desktop`（下载页与各平台安装包、一次性的未签名构建放行、配置模型、从 Chat 页发出第一条消息）、`quickstart-cli`（安装一行命令与 npm、`penguin web`、`penguin run`、`penguin chat`，以及 Installation 页原有的全部内容作为末尾的安装参考）、`quickstart-sdk`（安装 `@prismshadow/penguin-core`，以及逐行注解的第一个程序）。
- `DocsPageDef` 增加了 `children`，侧边栏将其缩进渲染在父项之下，`DOC_SLUGS` 把每个父项紧挨着摊平在其子项之前，使分页顺序与可见顺序一致。嵌套只做一层。
- `content/installation.{zh,en}.md` 被删除，构建后步骤不再为其生成路由外壳；原先指向它的链接——两个语种的 Introduction 页与 CLI 包的 README——都改指 Quickstart。
- `DOCS_NAV` 把 `guides` 移到了 `design` 之上：Start → Guides → Core Design → Reference。
- SDK 页覆盖了自己的分页后继，指向 Core Interfaces 而非 Web 应用指南。该覆盖只作用于向前一侧：Core Interfaces 仍保留其位置本身给它的前驱。

## 渲染器

- **标签式代码块**（`remark-tabs`）——信息串中带 `tab="Label"` 的围栏成为一个标签页，相邻的标签围栏归为同一个切换器。标签文字以 JSON 挂在整组上而不是各个块上，因为 `mdast-util-to-hast` 会把 code 节点的 `hProperties` 施加到内层的 `<code>` 上。只有选中的面板会被挂载；方向键在 roving tabindex 上于各标签间移动。
- **提示框**（`remark-callout`）——首行带 `[!TYPE]` 标记的引用块成为一个带框提示，末尾的 `-` 令其默认折叠，`+` 令其展开。折叠以原生 `<details>`/`<summary>` 输出，因此不耗费 JavaScript，正文也留在 DOM 中，供页内查找与 Copy Markdown 使用。`markdownToSearchText` 会剥除该标记，使类型与标志不进入搜索索引。
- **语法高亮**（Shiki）——高亮器基于 `shiki/core` 构建，只装入本站会用到的七种语法，并使用 JavaScript RegExp 引擎而非 Oniguruma，从而完全去掉 WASM 负载；全部置于动态导入之后（core 约 30 kB gzip，语法则仅在页面用到时才加载），入口包体积不变。两套主题通过双主题 CSS 变量烘焙进同一次渲染，因此明暗切换只是一次 CSS 切换。没有对应语法、或高亮器加载失败时，原样保留纯 `<pre>`，其内边距与字体与高亮输出一致。语法加载器逐个写成静态的 `import()`，因为 Vite 只会改写它能字面读懂的动态导入。

## 检查

`test/content.test.ts` 新增了这样几项检查：页内标题锚点唯一、每个 `[…](#anchor)` 都指向本页某个标题、每个 `[…](/slug)` 都指向一个已被导航的 slug，以及每个页面的分页都通向一个存在且不是自身的页面。其中的 slug 检查查出了 `agent-loop`、`server-api` 与 `web-app.en` 中五个失效的 `/docs/goal-mode` 链接——它们带上了路由本身已经提供的部署基路径；五处现已改为 `/goal-mode`。
