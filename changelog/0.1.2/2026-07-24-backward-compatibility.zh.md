# 本批次的向后兼容

- **Date:** 2026-07-24
- **Type:** process
- **Scope:** `core`, `server`, `web`
- **PR:** [#62](https://github.com/Prism-Shadow/penguin-harness/pull/62), [#63](https://github.com/Prism-Shadow/penguin-harness/pull/63), [#64](https://github.com/Prism-Shadow/penguin-harness/pull/64)

[English](2026-07-24-backward-compatibility.md)

本批次对磁盘上已有的数据与配置继续容忍哪些旧形态、每项容忍的生效范围有多大、用户是否需要动手，以及何时可以移除。其他条目描述功能本身并指向这里。

## 旧的尖括号标记仍可读

系统合成的标记改为成对的方括号形式（`[summary]`、`[context_summary]`、`[use_skills]`、`[handoff_from]`、`[scheduled_task]`、`[developer_instructions]`、`[turn_aborted]`、`[turn_retried]`、`[model_switch_from]`，以及内层的对话记录标签）。产出方只发出新形式，而所有可能遇到旧材料的解析器都同时接受两种形式。有两个来源使这一点无可回避：改动之前写入的 Trace，它们会在恢复时被重新渲染与回放；以及固化在每个已有 Agent 的 `system_config.yaml` 中的压缩提示词，只要该文件未被触碰，它就会继续要求模型用 `<summary>` 标签作答。`model_switch_from` 是一个更窄的情况——它的尖括号形式只存在于「合并后的 `/model` 切换在 main 上运行、而标记尚未落地」那段时间产生的 trace 中——但它搭乘的是同一套双形式解析器。

用户无需做任何事。该策略现在集中在一处——core 的 `omnimessage/markers/` 模块（以 `@prismshadow/penguin-core/markers` 导出），它拥有每个标记的产出方与解析器——因此日后移除这项容忍是改一个模块，而不是全仓扫荡。尽管如此，移除时间仍然遥遥无期：只要仍要求旧 Trace 能打开、旧 Agent 配置仍被逐字尊重，双形式解析器就不能撤，因此这属于大版本才能处理的事项，而不是某个小版本的清理工作。

## 恢复时仍会读取 session_meta.thinking_level

思考等级已成为逐请求参数，不再写入 `session_meta`。更早记录的 Trace 中仍带有该字段，因此恢复时会宽松地读取它，并继续把它作为该会话的默认等级来对待——这对那些从父级继承了等级、否则会以自身 Agent 配置等级回归的子 Agent 会话尤为重要。旧的字面量 `"default"` 与字段缺失一样，都回退到 Agent 配置，与此前一致；重建出的 meta 不会再写入该字段，而当旧 meta 携带它时，Trace 视图仍会渲染该行。

用户无需做任何事。这一项维持成本很低（一次宽松读取加上视图的回退），可以在不再支持恢复改动前的 Trace 之后移除——同样是大版本层面的决定。

## 已有 Agent 逐字保留其已存配置

Agent 的 `system_config.yaml` 完全按写入时的样子加载，不做迁移，也不与当前默认值做合并。因此已存在的 Agent 会保留其旧的系统提示词——包括旧的标记说明，以及被新提示词换成 App Data Dir 的旧 `Project Dir` 措辞——其记录的 `tools.builtin` 列表也保持冻结，因此它**不会**获得 `read_file` / `edit_file` / `write_file`；设置界面同样不会新增行。这是刻意为之：已存的配置是用户的文件。

因此采用新默认值需要用户动手，方式有二：执行**恢复默认配置**（Agent 设置的 Overview 标签页；`POST /api/projects/:projectId/agents/:agentId/config/reset`），它会把该文件重写为当前默认值，仅保留 Agent 的名称、描述与版本——所有自定义内容，包括编辑过的系统提示词、模型与压缩设置以及 MCP Server，都会被覆盖；或者手工编辑 YAML，只添加想要的条目。无论哪种方式，其他 Agent State 文件（AGENTS.md、Skill、vault）都不受影响。这里没有任何带截止期的临时兼容层——逐字加载就是预期行为，会一直保留。

## tools.call_description 缺失即为启用

逐工具的 `call_description` 开关决定是否把该工具的 `description` 参数提供给模型。缺失该键读作启用，因此在这个开关存在之前写入的配置中，那四个命令/子 Agent 条目无需任何人编辑即可继续接受调用描述；而显式的 `false` 会把该属性从组装出的 schema 中过滤掉，且从不重写已存的 YAML。这是一条默认取值规则，而非兼容层；它没有移除期限，日后若要翻转默认值则需要一次迁移。

## 本批次没有引入的兼容处理

分离源的 HTML 预览、新增的 OpenRouter 目录行以及开发数据根目录，都不带针对已存数据的兼容处理。不过有两点后果仍值得知道，二者都不属于被容忍的旧形态：

- 新的目录行会自动进入新建的 Project，因为预设清单是在 Project 的 `.project_config.toml` 创建时写入的。已有 Project 不会自行变化——用户通过模型页的**同步预设**或 CLI 的 `penguin config model add` 来获取新模型。
- 开发入口现在把 `PENGUIN_HOME` 默认指向 `~/.penguin/dev-data`。此前从源码运行所写入的数据仍留在原处，即已安装的根目录之下；想继续基于它工作的开发者显式导出 `PENGUIN_HOME` 即可，它依然优先于默认值。
