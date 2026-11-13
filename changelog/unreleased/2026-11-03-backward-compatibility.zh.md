# 本批次的向后兼容

- **Date:** 2026-11-03
- **Type:** process
- **Scope:** `server`
- **PR:** [#1445](https://github.com/Prism-Shadow/penguin-harness/pull/1445)

[English](2026-11-03-backward-compatibility.md)

本批次的每项兼容决定都只在这里记录一次；各功能条目引用本文件，不再复述。

## Agent State 之前位置上的 Workbench 及其版本

[Workbench 移入 Agent State](2026-11-03-workbenches-live-in-agent-state.zh.md)，[其版本改为 git 提交](2026-11-03-workbench-versions-are-git-commits.zh.md)。本批次之前，Agent 把 Workbench 放在 `<agentDir>/workbenches/<id>/`，每次成功加载的版本在 `<agentDir>/workbenches-history/<id>/<revision>/` 留一份完整副本（最多 20 份），由 `versions.json` 自新至旧列出。指向旧位置的存量数据有两类：

- 这些目录本身，每个安装都有，内置的 Support 应用及其工单也在其中；
- 每个 Agent 已安装的 `penguin-plugin` Skill 副本。本批次之前安装的副本在用户接受插件更新之前，仍会让 Agent 把 Workbench 写到 `<agentDir>/workbenches/`。

若不处理，升级后的安装列不出任何 Workbench，插件页会把 `penguin-support` 显示为未安装，Agent 按旧 Skill 文字做出的 Workbench 也永远不会出现。

选定方案（所有者决定）：**把目录移入，再在旧位置留下一个链接。** 服务端每次触及某个 Agent 的 Workbench 时（其 Workbenches 标签页、Workbench 页面、Agent 列表、该 Agent 的插件列表、插件安装、公司模式下的插件更新、Agent 快照导出或导入），都用一次 `lstat` 查看 `<agentDir>/workbenches`。不存在，或已经是链接，就无需再做什么。若是真实目录，则这样处理：

- 每一项都要稳定后才处理，因此 Agent 仍在写入的内容不会被动：对 Workbench（含 `package.json` 的目录）而言，是它的源文件最近 10 分钟内没有改动；对其他内容而言，是其中任何东西都没有改动。
- 已稳定、且 id 在 `agent_state/workbenches/` 中未被占用（比较时不区分大小写与 Unicode 形式）的 Workbench 以重命名移入，`state.json`、`.harness/` 与 `.plugin.json` 原样到达。
- 其余已稳定的内容（例如 macOS 访达留下的 `.DS_Store` 这类文件、不合法的名字、没有 `package.json` 的目录）移到 `<agentDir>/.workbench-migration/backup/workbenches/`，同名已存在时改用带编号的名字。它仍可恢复，但没有代码读取它。
- 移动之前，该 id 的 `versions.json` 列出的每个版本自旧至新写成 Agent State 仓库（`<agentDir>/agent_state.git`）中的一个提交，提交时间取原 `savedAt`。目录当前的文件和任何修改一样，由它首次成功的加载记录。历史与恢复显示的版本和时间与升级前一致。
- 随后该 id 的 `<agentDir>/workbenches-history/<id>/` 移到 `<agentDir>/.workbench-migration/backup/workbenches-history/<id>/` 并留在那里：没有代码会删除它。
- 旧目录清空后，替换为指向 `agent_state/workbenches` 的目录链接：Windows 上是 junction，无需管理员权限；其他平台是相对路径的符号链接。此后 Agent 按旧 Skill 文字写到旧位置的内容直接落进 Agent State，对已移入 Workbench 的修改也是如此。

升级后的首次访问时，所有目录早已稳定，因此全部一次移入，链接随之出现。同一次访问中刚由 Workflow 转换写出的目录视为已稳定。退路是同样的移动，只是推迟进行，此时旧位置保持为真实目录：id 被占用的 Workbench 留在原处，每个服务端进程以 `[workbenches]` 前缀记录一次日志；尚未稳定的内容等待之后的访问；无法创建的链接记录一次日志，目录保持真实。不覆盖、不合并任何内容，列出与加载照常进行。

无法读取或提交的版本以 `[workbenches]` 前缀记入日志、不进入历史，副本保留；目录本身照常移动。中断的运行由之后的访问完成，不会重复提交任何版本。链接存在期间，其目标始终保持存在：Agent State 导入换入一个没有 `agent_state/workbenches/` 的 State 后，会立即把该目录重新建好，因此经由旧位置的写入永远不会遇到悬空的链接。删除 Agent 时只删除链接本身，绝不经由链接删除 Workbench。与之共用 `.workbench-migration/` 的 Workflow 转换重新开始时，现在只清理它自己的暂存，因此这份备份不受影响。

### 生效范围

所有在 `agent_state/` 旁有 `workbenches/` 的 Agent 目录，涵盖所有服务端，包括机器。只有移入的 id 才读取其 `workbenches-history/` 副本。

### 用户需要做什么

无需操作。因 id 被占用而留在旧位置的目录会在服务端日志中点名；将其改名或移开后，之后的访问会把它收编。在 Agent 页面接受 `agent-development` 插件更新，可让该 Agent 的 `penguin-plugin` Skill 指向新位置；在那之前，由链接承接它的写入。

### 保留期限

Workbench 维护者保留这段代码与链接直到下一个大版本（1.0），并在该版本的发布准备中移除：`packages/server/src/workbenches/migrate-state.ts`、它在 `migrateWorkbenches`（`migrate.ts`）中的调用与 `test/workbench-state-migration.test.ts`；Workflow 转换已于 0.3 移除，因此 `migrateWorkbenches` 本身及其所有等待点（`workbenches/service.ts`、`services/agent-service.ts`、`http/routes/plugins.ts`、`http/routes/agent-transfer.ts`）也一并移除。这些都不随 0.3 的 Workflow 转换一起删除。1.0 的移除步骤同时删除 `<agentDir>/workbenches` 处指向 `agent_state/workbenches` 的遗留链接，因此没有任何东西比代码存在得更久。备份永远不会被代码删除。

## 兼容性

升级时无需操作。降级之后，旧版本经由链接在它预期的位置读写 Workbench。它记录的版本写入它自己的 `workbenches-history/`，之后再次升级时不会导入。
