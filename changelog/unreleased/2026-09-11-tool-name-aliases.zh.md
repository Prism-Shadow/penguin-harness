# 工具卡片用短名称呼内置工具

- **Date:** 2026-09-11
- **Type:** feature
- **Scope:** `web`
- **PR:** [#688](https://github.com/Prism-Shadow/penguin-harness/pull/688)

[English](2026-09-11-tool-name-aliases.md)

对话里的工具卡片不再显示模型调用工具时用的名字，而是用短名称呼七个内置工具：`read_file` 显示为
「读取」、`write_file` 为「写入」、`edit_file` 为「编辑」、`exec_command` 为「执行命令」、
`input_command` 为「跟进命令」、`run_subagent` 为「子智能体」、`input_subagent` 为「交流」，英文界面
另有一套自己的措辞。外观设置新增「工具短名」开关，默认开启，关掉即恢复原名。

## 细节

- 短名出现在卡片写出工具名的两处：折叠行的标题，以及待审批区块的名称标签。只要显示的是短名，两处的
  tooltip 都给出工具本来的名字。
- 只有内置工具有短名。MCP 工具与旧 Trace 里才有的名字（`kill_command`、`read_image`、
  `describe_image`、`kill_subagent`）在开关的两个位置都照原样显示。
- 轨迹观测、智能体设置的工具表、成本中心的错误码仍是工具原本的名字，审批规则与应用内一切按工具名做的
  判断也是——短名只在渲染那一处解析，不流向别处。
- 该偏好按浏览器记忆，键为 `penguin.toolAliases`，与其余外观选项同处。
