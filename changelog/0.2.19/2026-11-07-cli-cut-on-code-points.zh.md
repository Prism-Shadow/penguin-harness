# CLI 截短文本时不再把 emoji 切成半个

- **Date:** 2026-11-07
- **Type:** fix
- **Scope:** `cli`
- **PR:** [#1504](https://github.com/Prism-Shadow/penguin-harness/pull/1504)

[English](2026-11-07-cli-cut-on-code-points.md)

CLI 有几处输出会把文本截到固定长度，截的时候按 UTF-16 单元计数。一个 emoji 占两个单元，切在中间就会留下半个，终端上显示成 `�`。出问题的地方有：`penguin session ls`（改过名、超过 40 字符的标题）、`penguin agent ls`（超过 60 字符的描述）、工具调用的流式预览和审批内容，以及 `penguin browser`（`tabs` 表格和 `tabs:` 行里的标签页标题、点击元素的文字、对话框消息、exec 的返回值、`cdp` 的结果）。现在这些地方遇到跨在截断点上的 emoji，会停在它前面。各处的长度上限没有变。
