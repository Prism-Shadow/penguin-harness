# 大型工具目录可通过固定的搜索与调用网关访问

- **日期：** 2026-08-13
- **类型：** 功能
- **范围：** `core`、`cli`、`server`、`web`、`docs`
- **PR：** [#289](https://github.com/Prism-Shadow/penguin-harness/pull/289)

[English](2026-08-13-lazy-mcp-tool-exposure.md)

新增 `tools.toolExposure`，支持三种模式。`direct` 保持原有行为并作为默认值；`auto`
保留原生内置工具，当 MCP 目录较大时改用固定的 `search_tools` 和 `call_tool`；`lazy`
则将内置工具和 MCP 工具都放到同一网关后。Auto 在首次请求前根据 MCP Schema 的序列化
体积作出一次选择，阈值可通过 `tools.toolExposureThresholdTokens` 调整。

搜索结果包含版本化引用和输入 Schema。执行前，网关从私有目录解析引用、校验参数，
并沿用目标工具实际的权限、超时、输出限制、中断、流式返回和 Trace 行为。MCP 工具的新增、
删除或契约变化只更新私有目录，不改变模型可见的两个工具定义。旧引用会返回明确的失效原因；
存在替代契约时一并返回。人工审批展示服务端解析出的真实目标，不采用模型提交的展示文本。

本次改动还包含确定性的检索与上下文成本基准、端到端评估脚本，以及动态目录、刷新风暴、
过期引用、审批、Schema 校验、超时和输出限制的回归测试。
