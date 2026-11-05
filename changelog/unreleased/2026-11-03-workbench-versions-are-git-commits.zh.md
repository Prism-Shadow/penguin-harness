# Workbench 版本改为 git 提交

- **Date:** 2026-11-03
- **Type:** feature
- **Scope:** `server`, `web`
- **PR:** [#1443](https://github.com/Prism-Shadow/penguin-harness/pull/1443)

[English](2026-11-03-workbench-versions-are-git-commits.md)

Workbench 的版本不再是 `<agentDir>/workbenches-history/` 下的整目录副本，改由 Agent State 旁边的裸 git 仓库 `<agentDir>/agent_state.git/` 记录。该仓库记录 `agent_state/` 中的文件，服务端用内置的 isomorphic-git 写入，不依赖系统 git；`agent_state/` 内没有新增任何文件。一个 Workbench 的版本就是触及 `workbenches/<id>/` 的提交，其 revision 改为该目录的 git tree id。改动之前记录的版本由一次性迁移带入，见[向后兼容](2026-11-03-backward-compatibility.zh.md)。

## 细节

- 记录：每次成功加载把该 Workbench 的源码写成 `workbenches/<id>/`、叠在 HEAD 上提交一次，主题 `workbench <id> @<revision>`，作者 `PenguinHarness <penguin@localhost>`；文件未变的加载不提交，加载读取之后又被改动的文件留给下一次加载。第一次提交时在分支 `main` 上创建仓库，先在旁边建好再改名就位（此前崩溃留下的半成品一小时后清除），给人用的忽略规则写在其 `info/exclude` 中。服务端直接写 git 对象与分支 ref；没有暂存区，也没有工作区。写入仓库的每个文件都先写到临时名、刷入磁盘再改名就位，崩溃留下的空的或截断的对象文件会被重写，而不是沿用。人查看历史用 `git --git-dir=<agentDir>/agent_state.git log -- workbenches/<id>`。
- 从不入库：`.vault.toml`、`state.json`（以及该名字下的任何内容，不分大小写）、`.build/`、`.harness/`、`.plugin.json`、`node_modules/`、写入中的临时文件、符号链接，以及 git 在树中拒绝的名字（含反斜杠、去掉 HFS+ 忽略的字符后为 `.` 或 `..`、任意写法的 `.git`、`git~1`），加载时会在日志中列出这些名字；每个文件都以 `100644` 权限位提交。由其他工具写入、已含这类名字的树，读取时略去该条目并记日志，历史、提交与删除照常。Skill、hook、`AGENTS.md`、`system_config.yaml` 与 `memory/` 不入库。
- revision：`WorkbenchInfo.revision` 改为该目录 git tree id 的前 12 位十六进制（即 `git rev-parse HEAD:workbenches/<id>` 的输出），`uiRev` 为其 `ui/` 的 tree id。`.build/<revision>/` 与 `status.json` 随之采用新值；以旧哈希命名的编译产物由下一次加载清理。
- 历史：`GET …/workbenches/:id/history` 在最新的 2,000 个第一父提交内最多列出 50 个版本，最新在前，每条为 `{ revision, commit, savedAt }`；目录当前的版本即使早于这段回看也会列出，提交取回看所及的最早一个。`name`、`version`、`uiRev` 与 `files` 已删除。Web App 应用框内的历史列表不再显示版本的包版本号与文件数，各行以提交区分，同一 revision 出现多次时只有最新的一条标为当前。20 个版本的上限及其裁剪已移除。
- 回滚：`POST …/:id/rollback` 只接受历史中列出的 revision（否则 404），把目录源码恢复为恰好该树，文件与目录互换的情形也在内，`state.json` 与隐藏条目不动。先把该版本的文件写在一旁，再把现有文件移开、新文件移入；任何一步失败都把已移动的全部移回，移回也失败时，错误中给出保存原有文件的目录。随后的重载把恢复记为最新的一个版本。记录的树中含有源码以外的文件时拒绝恢复。
- 删除：`DELETE …/:id` 删除目录及其状态，并提交这次移除（`workbench <id>: removed`）。此前的提交仍留在仓库中，但不再列出；同一 id 重新创建的 Workbench 从新的历史开始。
- 失败：仓库写不进去时只记日志 `version not recorded`，不影响加载；历史读不出时应答 500 `workbench_history_unreadable`，页面提供重试。HEAD 不在分支上或无法读取、分支 ref 为空或不是提交 id，都按这种失败处理，而不是当作一段新的历史。
- 快照：Agent State 的快照与导出排除各 Workbench 的 `.build/` 与 `node_modules/`，以及服务端暂存的残留（`*.penguin-tmp*`）。导入时，路径中含 `.git` 段的条目一律不解出，去掉 `C:` 之类的盘符前缀之后再比较，大小写与 git 视同 `.git` 的各种写法都算在内。每次导入前都把当前 State 打包成新的 `snapshots/import-backup-v<version>-<time>-<random>.tar.gz`；已有的 `v<version>.tar.gz` 不再被当作备份复用，也从不覆盖。导出与导入都先执行 Workbench 迁移。导入还会先释放该 Agent 的 Workbench（其目录监视位于 `agent_state/` 内），并在导入结束前保持释放：其间对它们的请求等待导入结束。
- 对同一仓库的写入在服务端内按其路径依次进行。isomorphic-git 不打包对象，对象以松散形式存放；删除 `agent_state.git/` 即清除历史。
- `@prismshadow/penguin-server` 新增依赖 `isomorphic-git` `^1.44.0`。
