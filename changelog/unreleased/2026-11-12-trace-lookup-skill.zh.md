# Trace 查询插件

- **Date:** 2026-11-12
- **Type:** feature
- **Scope:** `plugins`, `docs`
- **PR:** [#1491](https://github.com/Prism-Shadow/penguin-harness/pull/1491)

[English](2026-11-12-trace-lookup-skill.md)

新增 `trace-lookup` 插件（`@penguinharness/trace-lookup`，办公效率类），内含一个同名 Skill，教 Agent 读自己的 Trace 文件：一个 Session 的文件在哪里、如何编号，`[context_summary]` 或 `[model_switch_from]` 块指向的是哪个文件，以及怎样查回更早的细节：先搜出它所在的行，再只读这几行，绝不整份读取。

## 细节

- Skill 给出 POSIX shell、PowerShell 与 cmd 下的搜索命令，以及用来查找用户与助手文本、某个工具的调用、工具输出、压缩起止和失败请求的记录片段。
- 此后初始化的 `default_agent` 随插件库的预装集一并获得该插件，新建 Project 与 CLI 首次运行都是如此。用户新建的 Agent 只有在创建时选中该插件才会安装。

## 兼容性

- 已有的 Agent（包括已有的 `default_agent`）不会自动获得该插件，也没有提示。需要它的 Agent 请在**插件市场**页面逐个安装一次：在「Trace 查询」卡片上点击**管理安装**，再点击该 Agent 旁的**安装**。Skill 从该 Agent 的下一个模型上下文起进入其系统提示词。
- 没有该 Skill 时，压缩摘要或交接说明里的 Trace 指针仍是可用的路径，指向每行一条记录的 JSONL 文件。
