# web-design Skill 先出前端、给长列表设边界、用 toast 确认操作

- **Date:** 2026-09-11
- **Type:** feature
- **Scope:** `plugins`
- **PR:** [#698](https://github.com/Prism-Shadow/penguin-harness/pull/698)

[English](2026-09-11-web-design-skill-tips.md)

`software-development` 插件里的 `web-design` Skill 吸收了公开的 Z.ai Code 提示词中的通用技巧——凡与该产品自家 SDK、技术栈和图片工具无关的部分。插件版本升至 `2026.09.11.1`。

## 细节

- Before you start：全栈需求先用假数据把前端做出来让用户尽早看到结果，再补后端；用户没指定技术栈时自行选定并说明——持久化用 SQLite 或 `localStorage`，缓存用进程内存，不引入一句话需求没要的 Redis、MySQL 之类基础设施。
- Ship complete：移动优先（手机布局是基线，`min-width` 媒体查询再加列）；语义化地标元素与 `.sr-only` 工具类，与 `alt`、`aria-label` 并列；每轮编码后读 dev server 日志的尾部与浏览器控制台，修完所有错误再展示页面。
- Components：同一网格里的卡片共享内边距并拉伸到等高；新增三个配方——可增长的列表放进带细滚动条的定高容器、区域加载用骨架块（点与 spinner 留给动作）、用户操作以 toast 确认，绝不用浏览器 `alert()`。
- Motion：所有可点击元素都有 hover 态与 `cursor: pointer`。
- 聊天布局：增量经 SSE 或 WebSocket 流式送达，绝不轮询；加载态点名区域用骨架。
