# core 测试固定了面向 Prompt 缓存的请求组装

- **Date:** 2026-09-14
- **Type:** test
- **Scope:** `core`
- **PR:** [#722](https://github.com/Prism-Shadow/penguin-harness/pull/722)

[English](2026-09-14-prefix-cache-awareness.md)

只有当下一次请求从头逐字节重复上一次——先 tools，再 system prompt，最后 messages——供应商才会命中
缓存前缀，因此引擎组装的每一轮都必须让请求保持为上一次的延长。`packages/core/test/prefix-cache.test.ts`
现在固定了这一点：由真实的 `ContextEngine` 驱动真实的 `GenerativeModel`（其供应商流被脚本替换），
对每一对相邻请求按客户端真正会发出的 wire 形态做诊断，诊断口径对齐供应商上报的缓存未命中原因
（`model_changed` / `system_changed` / `tools_changed` / `parameters_changed` / `messages_changed`，
取最早的分歧点，并给出分歧之后的输入量估算）。

## 细节

- 被固定的行为：一个 Session 的每次请求都延长上一次；任务执行中投递的 steering 与工具结果同乘一条
  user 轮次；调整 thinking 级别只产生一次 `parameters_changed` 并就此保持——压缩请求与压缩开出的新
  上下文都带着调整后的级别；压缩请求延长它紧跟的那一轮；恢复会话的首个请求以活动客户端已提交的
  历史开头，thinking 签名与工具配对都在。
- 有一条读数值得单独写成不变量：流式输出中途断线后的重连，会把这一轮连同一条带上已产出内容的 `[turn_retried]` 说明一起重发，因此被重试那一轮的输入是「变长」而不是「原样重复」。它之前的所有消息逐字节不变（工具、系统提示词与历史仍然命中）；测试固定的是分歧点绝不会提前，且原输入仍位于重试输入的开头。
- `packages/core/test/helpers/prefix-cache.ts` 提供录制模型、诊断函数与 wire 历史读取。它只度量
  harness 这一半：缓存有效期、断点回溯范围与最小可缓存长度属于供应商，需要真实 endpoint 才能验证。
