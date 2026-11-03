# penguin-plugin Skill 与文档随 Workbench 移入 Agent State 更新

- **Date:** 2026-11-03
- **Type:** fix
- **Scope:** `skills`, `plugins`, `docs`
- **PR:** [#1446](https://github.com/Prism-Shadow/penguin-harness/pull/1446)

[English](2026-11-03-workbench-guidance-follows-agent-state.md)

`penguin-plugin` Skill、插件 README 与文档不再指向 `<agentDir>/workbenches/` 和 `workbenches-history/`，改为写明 Agent 的工作台位于 `agent_state/workbenches/<id>/`、版本记录在 `agent_state/.git`，以及工作台标签页的 zip 导入与导出。见 [Workbench 移入 Agent State](2026-11-03-workbenches-live-in-agent-state.zh.md)、[Workbench 版本改为 git 提交](2026-11-03-workbench-versions-are-git-commits.zh.md)与[工作台可导入与导出 zip](2026-11-03-workbench-import-export.zh.md)。

## 细节

- `penguin-plugin`：描述、搭建步骤与 Layout 改为 `<App Data Dir>/agents/<agent_id>/agent_state/workbenches/<workbench_id>/`。Layout 新增一段说明 `agent_state/.git`：服务端提交什么、从不提交什么；在那里使用 git 只能读取，或把某一个工作台的目录写回；不得删除或改写这个仓库，也不得在 `agent_state/` 中运行 `git clean`，否则会删掉 Agent State 中其余未入库的内容，加上 `-x` 还会删掉 `state.json` 与 `.vault.toml`。
- `penguin-plugin` 的 HTTP 一节：历史条目改为 `{ revision, commit, savedAt }`，恢复记为最新的一个版本，删除会记录这次移除、此前的版本不再列出，并补上 `POST /archive` 与 `GET /:id/archive`。
- `penguin-plugin` 的「Undoing, reverting, removing」：去掉 `workbenches-history/`。移除只删除工作台目录，`agent_state/.git` 保持不动。撤销时请用户使用「History → Restore」，或调用 `POST /:id/rollback`；装有 git 时也可用 `git log --oneline -- workbenches/<id>` 与 `git checkout <commit> -- workbenches/<id>`，该版本之后新增的文件会留在原处。
- Skill 的 `version` 改为 `2026.11.03.1`，已安装的副本因此会收到更新提示。
- `plugins/penguin-support/README.md` 与 `plugins/README.md` 写明安装位置以及版本历史所在。
- 文档（中英文同步）：「技能与插件 › Workbench 插件」写明安装位置，并说明版本是 `agent_state/.git` 中的提交。「智能体」新增工作台标签页一节与设置表中的一行（历史与恢复、打包导出、导入 zip 及其覆盖确认、移除），在 Agent State 的内容中列出工作台，并写明导入快照时保留当前的工作台版本历史；「核心概念」与「自我进化」随之更新。
