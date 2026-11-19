# 压缩提示写明服务商拒绝的原因

- **Date:** 2026-11-19
- **Type:** fix
- **Scope:** `web`, `docs`
- **PR:** [#1630](https://github.com/Prism-Shadow/penguin-harness/pull/1630)

[English](2026-11-19-compaction-notice-reason.md)

服务商拒绝请求、对话改由 Trace 交接说明接续时，输入框上方的提示现在先写服务商的原话，再给建议。**压缩完毕**一行的状态图标对每种错误码都先写原因。

## 细节

- 提示分两行。第一行为「服务商拒绝了上一次请求：」，其后是服务商报文原文，超过两行时折叠并带**展开**，行末的**详情**打开这次拒绝的请求失败详情：完整报文、复制，以及预填的 GitHub issue。服务商没有给出报文时，第一行以句号结束、单独成句。
- 第二行为建议，措辞改为「多半是留给压缩的空间不足，……」，因为上一行服务商的原话可能指向别的原因。
- **详情**只在带请求失败详情对话框的主对话页显示；没有该对话框的输入区只显示原话、不带这个操作。
- 压缩行的悬停提示与可访问名每项一行：先是原因，用重试行的措辞并附报文里写明的 HTTP 状态码，其后接错误原文（错误码没有对应措辞时只写原文）；再说明未能生成完整摘要；留给压缩的空间不足（`rejected` 或 `output_truncated`）时另有一行说明要更正什么。此前建议在前，且只有请求被拒时才附服务商原话。
- 请求失败报告新增交接一种情形：「the provider refused the request, and the conversation continued in a new context from a Trace hand-off note」，并附模型、时间与服务商报文，与其他报告一样去除敏感内容。
- 文档「[Agent 运行循环](https://penguin.ooo/docs/agent-loop)」一页随之更新了提示与悬停提示的说明。
