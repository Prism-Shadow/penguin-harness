# 回复里链接的音频文件在段落下方播放

- **Date:** 2026-10-03
- **Type:** feat
- **Scope:** `web`, `ui`, `server`, `plugins`

[English](2026-10-03-file-renderers.md)

插件可以声明某类工作区文件如何呈现，Web 在链接该类文件的回复段落下方呈现它。

- 服务器的 `WebModule` 新增 `fileRenderers` 槽位：`{ extensions, renderer }`，扩展名不带点、比较时不区分大小写。`GET /api/contributions` 以 `fileRenderers` 返回。
- 对话中，助手回复的段落或列表项链接到扩展名命中规则的工作区文件时，在该块正下方绘制所指名的 renderer：每个文件一次，按链接顺序。Markdown 不变，链接保持原有点击行为（在文件面板中打开）。代码里的链接不是链接。renderer 在回复结束后出现，流式输出期间不出现。安全模式与其他贡献一样跳过这些规则。
- Web 内置一个 renderer `audio`：以工作区文件 URL 为源的浏览器播放器（`preload="none"`），可访问名称含文件名；加载失败时变为一行说明文件无法播放。renderer 按名字登记在 chat 的槽位 `ChatModule.fileRenderers`；renderer 为 iframe 的规则被跳过。
- UI 包的 Markdown 渲染新增 `ProseBlockTrailerProvider`：调用方可在 settled 渲染时，根据段落或列表项内的链接在其后追加内容。
- 工作区中 `.mp3`、`.wav`、`.ogg`、`.m4a` 文件改以对应的音频 Content-Type 返回，而非 `application/octet-stream`。
- `plugins/example-music`：示例插件，贡献 `mp3`/`wav`/`ogg`/`m4a` → `audio`，并附 `send-music` Skill，教 Agent 在工作区合成一段短曲并在回复中链接。Skill 需手工安装到 Agent（见插件 README）。它是 private 包，不会发布；作为 `plugins/example-*` 目录也不会随构建内置，除非设置 `PENGUIN_PLUGIN_EXAMPLES=1` 让构建把示例插件与内置插件一并放入插件目录，之后由项目按包名启用。Web e2e 在运行时两步都做。
