# 插件扩展 Web：自己的页面、移除页面与文件渲染

- **Date:** 2026-10-03
- **Type:** feat
- **Scope:** `web`, `ui`, `server`, `plugins`

[English](2026-10-03-web-plugin-contributions.md)

插件可以改变 Web 的页面组织与文件呈现：在已有页面下添加页面并框入自己的文档、按 key 移除页面、声明某类工作区文件如何在链接它的回复下方呈现。

## 页面

- 页面数据增加 `parent`（页面 key），Web 的 `WebAppModule.pages` 与服务器的 `WebModule.pages` 一致。服务器槽位同时声明 `title`、`titleZh`、`icon`，贡献页面的导航行因此有中英文名称与图标。`ContributionsResponse.pages` 的类型为 `WebPageContribution`。
- 侧边栏把子页面画成父页面下方的缩进行，随父页面所在的分区；子页面没有自己的置顶按钮，也不能拖动。折叠的 rail 不为它画行，打开它时父页面高亮。父页面不存在的页面既不在导航里也不被路由；页面只嵌套一层：父页面自身带 parent 的页面被丢弃。
- `GET /api/plugins/<包名>/ui/*` 提供已加载插件 `ui/` 目录下的文件，仅限登录用户。其他包一律 404，离开 `ui/` 的路径（含符号链接）同样 404。workflow 的 `ui/*` 路由改用同一份 MIME 表与响应头（`http/static-files.ts`）。

## 移除页面

- 服务器的 `WebModule` 新增 `pageRemovals` 槽位：`{ key }`。`GET /api/contributions` 以 `pageRemovals` 返回。
- Web 从页面表中去掉所指名的页面，连同路径落在其路径之下的路由（移除 `benchmark` 也带走 `/benchmark/:benchmarkId`）与导航中挂在它下面的页面。被移除的页面在侧栏和收起后的 rail 中都没有行，其 URL 落到兜底路由、回到首页（开发模式下为 chat 页面，公司模式下为组织页）。首页及其去处的页面不可移除；`/login` 不在页面表中。移除随其他贡献一起到达，因此刚加载时被移除的页面可能短暂出现后才消失。安全模式不读取贡献，因此不移除任何页面。

## 文件渲染

- 服务器的 `WebModule` 新增 `fileRenderers` 槽位：`{ extensions, renderer }`，扩展名不带点、比较时不区分大小写。`GET /api/contributions` 以 `fileRenderers` 返回。
- 对话中，助手回复的段落或列表项链接到扩展名命中规则的工作区文件时，在该块正下方绘制所指名的 renderer：每个文件一次，按链接顺序。Markdown 不变，链接保持原有点击行为（在文件面板中打开）。代码里的链接不是链接。renderer 在回复结束后出现，流式输出期间不出现。安全模式与其他贡献一样跳过这些规则。
- Web 内置一个 renderer `audio`：以工作区文件 URL 为源（`preload="none"`）的紧凑单行播放卡片，用主题 Token 绘制，与对话中的其他卡片同一圆角、边框与底色：强调色圆形播放/暂停按钮、文件名、已播放/总时长，以及一条细进度条（浅色段标出已加载、可跳转的范围）；宽度有上限，元数据到达时不发生布局位移。按钮与进度条均有含文件名的可访问名称，进度条支持方向键与 Home/End。加载失败时，卡片变为一行说明文件无法播放。renderer 按名字登记在 chat 的槽位 `ChatModule.fileRenderers`；renderer 为 iframe 的规则被跳过。
- UI 包的 Markdown 渲染新增 `ProseBlockTrailerProvider`：调用方可在 settled 渲染时，根据段落或列表项内的链接在其后追加内容。
- 工作区中 `.mp3`、`.wav`、`.ogg`、`.m4a` 文件改以对应的音频 Content-Type 返回，而非 `application/octet-stream`。
