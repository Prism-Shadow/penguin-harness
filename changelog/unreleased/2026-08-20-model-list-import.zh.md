# 新增分组对话框可一键导入供应商全部模型

- **Date:** 2026-08-20
- **Type:** feature
- **Scope:** `web`, `server`, `core`
- **PR:** [#368](https://github.com/Prism-Shadow/penguin-harness/pull/368)

[English](2026-08-20-model-list-import.md)

模型页「新增分组」对话框新增可选的 Base URL 与 API key 字段和「检测并导入」动作：先用既有探针检测端点协议，再获取该端点服务的全部模型 id，并在一次保存中把它们全部作为新分组的条目写入——每个条目内联携带 base URL、检测出的协议与所填 key。手动路径（只填分组名进入新增模型对话框）保持不变。

## 细节

- 列表能力来自 AgentHub 0.4.5 的 `listModels()`（agenthub [#183](https://github.com/Prism-Shadow/agenthub/pull/183)）：core 暴露对 `AutoLLMClient` 的薄封装 `listEndpointModels`，server 以 `POST /api/projects/:p/models/list` 对外提供（仅 owner，base URL 校验与 DTO 约束同 `/detect`；列表请求限时 20s）。
- 省略 API key 时沿用连通性测试的环境变量链（按协议读取 `OPENAI_API_KEY` / `ANTHROPIC_API_KEY`）。key 只出现在上游请求头中，绝不回显。
- 模型 id 按端点返回顺序保留；重复项——无论出现在列表内部还是与已配置的 `(provider, model_id)` 对撞——都会被跳过并计入成功提示。
- 协议不支持列出模型（AgentHub `UnsupportedOperationError`）、检测失败或列表为空时,错误在对话框内呈现,手动路径始终一步可达;列表成功之前不落盘任何内容。
