# 发现未提供端点元数据的 Copilot 模型

- **Date:** 2026-09-19
- **Type:** fix
- **Scope:** `core`, `model-catalog`, `web`, `docs`
- **PR:** [#5](https://github.com/nicolaepocroianu/penguin-harness/pull/5)

[English](2026-09-19-copilot-model-discovery.md)

更新了开发用 AgentHub 补丁，在 Copilot 省略可选端点元数据时保留支持工具调用的聊天模型。

## 细节

- 优先遵循明确声明的端点限制，并从回退结果中排除了非聊天模型。
- 保留了 Penguin 的模型连接测试，用于导入后检查推理可用性。
