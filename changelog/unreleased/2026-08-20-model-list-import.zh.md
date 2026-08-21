# 新增分组对话框可一键导入供应商全部模型

- **Date:** 2026-08-20
- **Type:** feature
- **Scope:** `web`, `server`, `core`
- **PR:** [#368](https://github.com/Prism-Shadow/penguin-harness/pull/368)

[English](2026-08-20-model-list-import.md)

模型页「新增分组」对话框改为两种模式。**仅新增分组**保留轻量路径：名称合法即进入该分组的新增模型对话框。**导入模型**沿用新增模型对话框的字段节奏按端点填满全新分组——先填 API key，再填 base URL，其右上方是「检测协议」动作，输入框内嵌的协议菜单可手动改选；协议确定后，**「批量导入模型」**获取该端点服务的全部模型 id，并在一次保存中把它们全部作为新分组的条目写入，每条内联携带 base URL、协议与所填 key。

## 细节

- 列表能力来自 AgentHub 0.4.5 的 `listModels()`（agenthub [#183](https://github.com/Prism-Shadow/agenthub/pull/183)）：core 暴露对 `AutoLLMClient` 的薄封装 `listEndpointModels`，server 以 `POST /api/projects/:p/models/list` 对外提供（仅 owner，base URL 校验与 DTO 约束同 `/detect`；列表请求限时 20s）。
- 省略 API key 时沿用连通性测试的环境变量链（按协议读取 `OPENAI_API_KEY` / `ANTHROPIC_API_KEY`）。key 只出现在上游请求头中，绝不回显。
- 模型 id 按端点返回顺序保留；重复项——无论出现在列表内部还是与已配置的 `(provider, model_id)` 对撞——都会被跳过并计入成功提示。
- 检测失败只把协议后缀转为琥珀色、不阻塞任何操作：可手动选定协议，或切回仅新增分组。协议不支持列出模型（AgentHub `UnsupportedOperationError`）或列表为空时，错误在对话框内呈现；列表成功之前不落盘任何内容。
- 自建分组的组头新增**「删除分组」**动作：一次确认（写明分组与组内模型数）后，一次整表写入移除组内全部模型；指向被删分组的默认模型 / vision 模型指针按单模型删除的既有规则一并清除。内置分组不受影响。
- 连通性测试与视觉探测改为发送最低思考等级（`low`）而非关闭思考——部分推理端点会拒绝显式关闭思考的请求，导致探测败在自己所发的参数而非端点本身。
