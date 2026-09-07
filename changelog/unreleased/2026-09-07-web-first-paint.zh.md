# Web App 首屏立刻画出框架，一个往返就到侧栏

- **Date:** 2026-09-07
- **Type:** fix
- **Scope:** `web`
- **PR:** [#640](https://github.com/Prism-Shadow/penguin-harness/pull/640)

[English](2026-09-07-web-first-paint.md)

此前在手机上冷启动 Web App，要等整个入口 bundle 下载并解析完才有内容，之后又要在白屏里串行跑完四个相互依赖的请求——`/api/me`、Project 列表、该 Project 的 Agent 列表、最后才是侧栏的 Session 列表；而最大的一个依赖 KaTeX 每次加载都要解析，无论页面上有没有公式。本次改动缩短了其中每一段。

## 细节

- `index.html` 现在以静态标记加内联 CSS 直接带上应用的空框架——宽屏的侧栏、窄屏的顶栏，并采用已持久化的主题与侧栏宽度——于是 bundle 到达之前首屏就已经有了应用的形状。路由守卫在 `/api/me` 未返回期间渲染同一个框架（`BootSkeleton`），而不再渲染空白。
- 第一个往返在 React 挂载之前就发出：`lib/boot-prefetch.ts` 与 install-scope 探测同时请求用户、Project 列表以及记住的 Project 的 Agent 列表，auth 与 Project 两个 provider 各取用一次这些在途的答案，而不再自己发起。之后的重新加载仍照旧走网络。
- KaTeX 从入口移入独立的 chunk（`lib/markdown-katex.ts`，连同样式表），在某个已收束的正文首次含有数学分隔符时通过 `import()` 加载。加载落地之前（每次页面加载一次），公式显示自己的 TeX 源码——与流式输出中的正文本来就一样——并在加载触发的重渲染中排版。所有 Markdown 界面现在都经由同一个 `<Markdown>` 组件渲染，这个决定就在那里做出。
- 除聊天页外的每个页面都是懒加载的路由 chunk：agents、agent 设置、plugins、models、usage、benchmark 与终端在首次打开时才获取。

以本次改动自身的构建做前后对比：入口脚本从 1,662 kB（gzip 499 kB）降到 1,176 kB（gzip 363 kB），入口样式表从 123 kB（gzip 24 kB）降到 96 kB（gzip 17 kB）；KaTeX 成为一个 270 kB（gzip 81 kB）的 chunk，没有公式的页面从不请求它。
