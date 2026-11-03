# Workbench 版本改为 git 提交

- **Date:** 2026-11-03
- **Type:** feature
- **Scope:** `server`, `web`
- **PR:** [#1443](https://github.com/Prism-Shadow/penguin-harness/pull/1443)

[English](2026-11-03-workbench-versions-are-git-commits.md)

Workbench 的版本不再是 `<agentDir>/workbenches-history/` 下的整目录副本，改由覆盖 Agent State 的 git 仓库 `agent_state/.git` 记录，服务端用内置的 isomorphic-git 写入，不依赖系统 git。一个 Workbench 的版本就是触及 `workbenches/<id>/` 的提交，其 revision 改为该目录的 git tree id。改动之前记录的版本由一次性迁移带入，见[向后兼容](2026-11-03-backward-compatibility.zh.md)。

## 细节

- 记录：每次成功加载把该 Workbench 的源码写成 `workbenches/<id>/`、叠在 HEAD 上提交一次，主题 `workbench <id> @<revision>`，作者 `PenguinHarness <penguin@localhost>`；文件未变的加载不提交。第一次提交时在分支 `main` 上创建仓库，并写入 `agent_state/.gitignore`（已有则不写）。服务端直接写 git 对象与分支 ref，不经暂存区与工作区，提交后再更新暂存区，使 `agent_state/` 里的 `git status` 对各 Workbench 目录显示干净。
- 从不入库：`.vault.toml`、`state.json`、`.build/`、`.harness/`、`.plugin.json`、`node_modules/`、写入中的临时文件与符号链接；每个文件都以 `100644` 权限位提交。Skill、hook、`AGENTS.md`、`system_config.yaml` 与 `memory/` 不入库。
- revision：`WorkbenchInfo.revision` 改为该目录 git tree id 的前 12 位十六进制（即 `git rev-parse HEAD:workbenches/<id>` 的输出），`uiRev` 为其 `ui/` 的 tree id。`.build/<revision>/` 与 `status.json` 随之采用新值；以旧哈希命名的编译产物由下一次加载清理。
- 历史：`GET …/workbenches/:id/history` 在最新的 2,000 个第一父提交内最多列出 50 个版本，最新在前，每条为 `{ revision, commit, savedAt }`。`name`、`version`、`uiRev` 与 `files` 已删除，Web App 的历史列表不再显示版本的包版本号与文件数。20 个版本的上限及其裁剪已移除。
- 回滚：`POST …/:id/rollback` 只接受历史中列出的 revision（否则 404），把目录源码恢复为恰好该树，`state.json` 与隐藏条目不动，随后重载，恢复因此记为最新的一个版本。记录的树中含有源码以外的文件时拒绝恢复。
- 删除：`DELETE …/:id` 删除目录及其状态，并提交这次移除（`workbench <id>: removed`）。此前的提交仍留在对象库中，但不再列出；同一 id 重新创建的 Workbench 从新的历史开始。
- 失败：仓库写不进去时只记日志 `version not recorded`，不影响加载；历史读不出时应答 500 `workbench_history_unreadable`，页面提供重试。HEAD 不在分支上时不记录版本。
- 快照：Agent State 的快照与导出排除 `agent_state/.git` 以及各 Workbench 的 `.build/` 与 `node_modules/`。导入像保留 vault 一样保留该 Agent 现有的仓库，丢弃包内携带的 `.git`，并先释放该 Agent 的 Workbench（其目录监视位于 `agent_state/` 内）。
- 同一 Agent 的仓库写入依次进行。isomorphic-git 不打包对象，对象以松散形式存放；删除 `agent_state/.git` 即清除历史。
- `@prismshadow/penguin-server` 新增依赖 `isomorphic-git` `^1.44.0`。
