# 路线图讨论室旁的路线图改由 App 画

- **Date:** 2026-09-29
- **Type:** feature
- **Scope:** `web`, `plugins`
- **PR:** [Myriad-Dreamin/penguin-harness#22](https://github.com/Myriad-Dreamin/penguin-harness/pull/22)

[English](2026-09-29-roadmap-room-column.md)

路线图讨论室右侧那一栏，改由 Web App 按 company-roadmaps 插件对这份路线图的应答自己画，不再嵌入插件页面的 detail 视图。

## Details

- 条目排在最前，列表的样子照提案页：已链接提案的 proposal 条目就是那份提案的一行（编号、当前标题与状态，点开进提案页）；未链接的条目显示所处阶段——草稿、等待两道批准的 brief（谁批的、何时批的，人还没批时带 **批准** 按钮），或已委派。proposal 条目排在子路线图条目之前。
- 主持人、条目负责人、子路线图的相关员工，以及是员工的批准人，都照提案页显示为头像加名字，不再显示员工 id。
- body 排在条目之后，走频道消息的 Markdown 管线渲染——标题、列表、`proposal:<n>` 引用胶囊、`@` 提及显示为名字、脚注显示为注记——直接铺在栏里，外面不再套卡片。
- 这一栏不再显示 record；插件仍保存并返回它。
- 这一栏是 App 自己的滚动容器，用上了 App 的细滚动条。
- 路线图的主持人在讨论室会话里会被告知：body 按 Markdown 显示，引用提案写 `proposal:<n>`，注记写脚注。
- 插件自己的路线图页（全部路线图）不变。
