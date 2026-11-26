# 聊天 Markdown：单个波浪号不再算作删除线

- **Date:** 2026-11-26
- **Type:** fix
- **Scope:** `chat-markdown`
- **PR:** [#1884](https://github.com/Prism-Shadow/penguin-harness/pull/1884)

[English](2026-11-26-single-tilde-not-strikethrough.md)

单个 `~` 不再和下一个 `~` 配成 GFM 删除线，同一段里的两处区间写法因此不会再把它俩之间的内容整段划掉——包括那段内容里的 `**`。`耗时 3~5 天，进度 **10~20%**` 现在显示为粗体，不再露出星号；`alpha 0.3~0.8 → **0.45~1.0**，新增**脉冲金环描边**` 两处粗体都保得住。`~~` 照旧解析，凡按聊天方言读回复的地方都遵循这条规则：Web App 与聊天渠道。

## 细节

- 没有任何一端会渲染删除线：各端都把回复里的波浪号按原样显示（Web App 里是 `remark-literal-tildes.ts`，`library/messaging` 里是同一趟处理）。单个波浪号剩下的唯一作用就是让 `~…~` 把它里面的 Markdown 吞掉，所以它现在按正文处理。
- 区间（`3~5 天`）、约数（`~30 秒`）与 `~d~` 的显示与以前一致；`~~gone~~` 在语法树里仍然是一个删除线节点。
- 两端共用同一个入口：Web App 的对话记录与各聊天渠道都通过 `@prismshadow/penguin-ui/chat-markdown` 解析回复。
