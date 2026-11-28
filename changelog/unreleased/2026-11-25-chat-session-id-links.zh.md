# 会话 id 变可点链接：点开即到那场会话

- **Date:** 2026-11-25
- **Type:** feature
- **Scope:** `web`
- **PR:** [#1876](https://github.com/Prism-Shadow/penguin-harness/pull/1876)

[English](2026-11-25-chat-session-id-links.md)

对话文本、工具输出与 Markdown 里的会话 id 现在渲染成链接：点开即到 `/chat/<sessionId>` 那场会话。

## 细节

- 用户消息与组织通知的正文按会话 id 拆段，逐个渲染成链接；组织对话的 Markdown 正文与行内代码同样识别会话 id，无项目作用域时也成立。
- 工具调用输出里独立成行的会话 id 在卡片底部渲染成跳转角标：去重、至多五条；输出折叠或仍在流式时不出，绑定子代理的卡片不出。
- 站内路由（`/chat/…`、`/org…`）与其 localhost 等价形式经应用 Router 原地导航，不再被外站链接防护挡下；普通点击原地跳转，修饰键与中键保持浏览器默认。
- 路由会话 id 按完整 id 解析；从组织工单深链打开的会话每次进入在侧栏 Temporary 组登记一次。
