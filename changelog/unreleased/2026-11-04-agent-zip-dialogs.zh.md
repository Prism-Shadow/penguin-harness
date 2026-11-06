# 通过两个共用弹窗导出与导入 Agent

- **Date:** 2026-11-04
- **Type:** feature
- **Scope:** `web`, `ui-gallery`, `docs`
- **PR:** [#594](https://github.com/Prism-Shadow/penguin-harness/pull/594)

[English](2026-11-04-agent-zip-dialogs.md)

Web App 通过 Agents 页面与 Agent 设置页共用的两个弹窗，把 Agent 导出为 zip、从 zip 导入 Agent，或从其他编程 Agent 的配置迁移进来。它们取代了设置页的快照导出与导入，以及创建弹窗的「从快照初始化」。

## 细节

- **导出。** 每张 Agent 卡片新增「导出 Agent」图标，设置页概览的 Agent State 区块新增「导出…」按钮。弹窗总会带上配置，可另选技能、钩子、记忆、工作台（其下有「含其数据」子选项）与定时任务（默认不勾：导入后会按计划运行），对话可选「不含」「最近 N 条」（默认 20，最多 500）或「日期范围」。其下一行来自 `GET …/archive/preview`，在最后一次改动 300 ms 后重新查询，给出文件数、大小与对话数；未压缩超过 100 MB 时附注，有因单个文件过大而不导出的对话时给出其数量，服务端的说明按代码译成界面语言；服务端会拒绝导出的选择会说明原因，「导出」保持不可用；Agent 自身的配置无法解析时（422 `invalid_config`，两种语言均有文案）同样如此。「导出」从 Agent 所在的服务端下载 `<agentId>-<yyyymmdd>.zip`，失败为 toast。控件即时生效，不记住上次选择。
- **导入。** Agents 页页头在创建按钮组旁新增「导入 Agent」。第一节「从其他框架迁移」选择 Claude Code、Codex、DeepSeek Harness、Qoder、Qwen Code、WorkBuddy 或其他，填写路径（缺省为该框架的用户目录，选「其他」时必填），预览完整 Prompt，并以 Project 默认 Agent 打开新对话、把 Prompt 填进输入框：Prompt 点名框架、路径与 Project，要求使用 `agent-porting` 技能（没有就停下说明）并用 `penguin agent import` 导入该 Project。默认 Agent 没有这个技能时（它上线之前创建的默认 Agent 都是如此），这一节会说明，并提供把 `skill-porting` 插件装到该 Agent 上的操作，技能就位之前对话保持不可用；安装被拒时显示服务端给出的原因。该 Agent 已有这个插件的 Skill 时，安装即更新、会整体替换它们，因此先弹出插件市场页面的更新确认并列出它们（列表行抽成了两处共用的组件）。另一节已选文件时打开对话会先询问。第二节「导入文件」接受 `.zip`（1.0 之前也接受旧的 `.tar.gz` 包，见[向后兼容](2026-11-04-backward-compatibility.zh.md)），按文件名预填 Agent id（`.tar.gz` 不记录 id，因此必填；替换模式下用的是本 Agent 的 id，不必填写），超过 100 MiB 上传上限的文件在发送前即被拒绝，以 `application/octet-stream` 原样上传文件。id 已被占用（409 `agent_exists`）时就地显示「改用其他 id」，Project owner 另有「覆盖现有 Agent」：确认一次后带 `overwrite=1` 重发。导入成功后 toast 列出导入的内容、略过的对话、须填写的键与服务端的说明（按代码本地化，未知代码沿用服务端原句），并重新读取 Agent 列表。
- **从文件替换。** 设置页概览的「从文件替换…」（仅 owner）以不含迁移一节与 id 框的方式打开导入弹窗：确认一次（危险色调），再以该 Agent 的 id 带 `overwrite=1` 上传，页面随后重新读取配置。版本冲突的二次提示不再出现。
- 创建弹窗移除了快照初始化，页脚改为一行指向「导入 Agent」的提示。Web 客户端移除 `agentExportUrl` 与 `importAgent`，新增 `agentArchiveUrl`、`previewAgentArchive` 与 `agentImportUrl`；归档下载助手也能读取不编码的 `filename="…"`。组件画廊的 mock API 应答预览、下载与导入（只读）。
- 智能体与 Web App 文档描述了两个弹窗、导出图标与从文件替换。
