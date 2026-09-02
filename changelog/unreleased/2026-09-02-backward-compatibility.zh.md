# 向后兼容

- **Date:** 2026-09-02
- **Type:** process
- **Scope:** `server`, `core`, `web`, `cli`
- **PR:** [#542](https://github.com/Prism-Shadow/penguin-harness/pull/542)
- **Breaking:** yes — 首个只能重启应用的 schema 迁移：向运行中的运行时热推送本版本会被拒绝，直到运行时重启；本版本之前就存在的 Agent 上发起目标模式会收到 409，直到给它装上 `goal` 插件

[English](2026-09-02-backward-compatibility.md)

[Hook 进入核心、目标模式与持续学习成为插件、技能库改为插件库](2026-08-29-stop-hook-goal-mode.zh.md)
动到了六样会跨越版本存活的东西：自 0.1.3 起每个 `web.db` 都带着的 `goal_state` 表、既有 Agent
没有的钩子包、从旧技能库装上的 Skill 的版本与图标、旧 Trace 里的 `goal_finished` 记录与 `[goal]`
轮消息、`@prismshadow/penguin-skills` 包，以及 Agent 创建的 `skills` 字段 / `--skills` 选项。需要
做决定的只有那张表；其余几项也一并记在这里，方便有人来查「我这套安装需要做什么吗？」时，在同一处
找到全部答案。

## `goal_state` 表：由第 3 号迁移删除，也是首个只能重启应用的迁移

自 0.1.3 起创建的每个 `web.db` 都有 `goal_state`（每次目标运行一行：objective、status、budget、
used、rounds）及其索引 `idx_goal_session`。这些行只被读回来做一件事——页面刷新后恢复对话页的目标
横幅——而本版本改读 Session scratchpad 里 goal 插件的 `GOAL.json`。再没有什么会写这张表，新建的数
据库也不再带它。

选择：**用有序迁移把它删掉**——`db/migrations.ts` 里的第 3 号 `drop-goal-state`——而不是留下一张
新库与升级库永远不一致的死表。迁移在运行时自己的打开（`openDatabase`）时执行一次，盖章
`PRAGMA user_version = 3`，对本构建新建的数据库幂等（`IF EXISTS`）。它的 `down` 把表按 0.2.9 的声
明原样重建——**空表**：删掉的行一去不返，而它们唯一供给的东西——已结束目标的横幅——就是回不来的那
一样。

它是 `swapSafe: false`，也是第一个这样的迁移。热推送的平台在活的数据库上启动，启动失败即回滚到前
一个平台；一个在进程中途发现 `goal_state` 没了的前任平台会对着空无一物去准备它的目标语句，而它自己
的声明式建表只在完整打开时才跑。因此推送在任何 DDL 执行之前就被整个拒绝，`RestartRequiredError`
点名这个迁移：当前平台照常运行，重启服务端（或桌面应用）时在打开阶段应用迁移。用户要做的只有这一
件事，一次——而且只有热推送的用户才需要；安装器或包更新本来就会重启。

降级到 0.2.9 可行：它的 `openDatabase` 会重新声明这张表（`CREATE TABLE IF NOT EXISTS`），也没有待
应用的迁移，于是目标模式照常运行，只是横幅里没有此前目标的历史。需要在本构建上把表找回来的运维方
有 `rollbackTo(2)`。

**这里没有任何需要日后删除的东西，也没有人被挂上这笔账。**迁移按机制自身的规则是永久的——版本号发
布后不重编号、不改写——而 `IF EXISTS` 也不是垫片：正是它让同一条语句在本构建新建的数据库上也成立。

## 既有 Agent 没有钩子包

钩子包是新东西；今天已存在的 Agent 的 `agent_state/hooks/` 是空的，启动时也不会向既有 Agent 安装
任何东西（本批记录的决定：安装策略随创建而定，既有 Agent 从不被改写）。在这样的 Agent 上发起目标
模式会收到 `409 goal_plugin_not_installed`——Web App 会直说并指向插件库——直到给它装上 `goal`，每个
Agent 点一次。本版本起新建的每个 `default_agent` 都自带。

没有兼容代码，没有要删的东西。`continual-learning` 在任何地方都不预装，以同样方式安装。

## 从旧技能库装上的 Skill：自然数版本与图标

本版本之前安装的 `SKILL.md` 带的是旧的自然数 `version`（以及 `updated` 日期）。解析器把不是
`YYYY-MM-DD.N` 的版本读作空字符串，`comparePluginVersions` 把非版本排在一切版本之前，因此插件库会
把这样的插件各报一次可更新；更新（整插件重装）即写入日期版本。这个排序是比较本身的定义，不是有
效期的容忍——日后没有要删的东西。

图标：库安装现在把插件的 `icon.svg` 写在它携带的每个 Skill 旁边、也写在钩子包的 `hooks.json` 旁
边。本版本之前安装的 Skill 保持原样——八个自带图标的库内 Skill 是各自的 `icon.svg`，其余是书本图
形——直到从库更新该插件。无需操作，没有兼容代码。

## 旧 Trace：`goal_finished` 记录与 `[goal]` 轮消息

早期版本写下的 Trace 带有 `goal_finished` 事件记录（读取方当作未知事件跳过）和以 `[goal]` 块起头
的轮消息。标记连同它的解析器一起移除，所以这些消息按纯用户文本渲染——块原样可见、没有轮次小注——
并像任何用户消息一样进入对话索引与输入历史；新的轮消息改带 `sender: "harness"` 标记。随标记移除
一并接受：另一种选择是为一个再没人写的协议保留解析器。日后没有要删的东西。

## `@prismshadow/penguin-skills`

弃用；该名下不再发布新版本，发布链改发 `@penguinharness/*` 各插件包，由 `@prismshadow/penguin-core`
加载。旧包在 npm 上原样保留。钉住它的安装继续与其钉住的版本一起工作。

## Agent 创建的 `skills` → `plugins`，CLI 的 `--skills` → `--plugins`

Agent 创建请求体改收 `plugins: string[]`（库内插件名），原来是 `skills`；`penguin agent create`
改收 `--plugins`。干净改名，没有别名：仍发送 `skills` 的脚本会得到一个什么都不预装的 Agent（该字段
被忽略），仍传 `--skills` 的脚本会撞上 CLI 的未知选项错误。改一下调用即可。

## 兼容性

升级只对一种用户提一个要求：把本平台热推送到运行中的运行时的人，必须先重启它——推送在碰到数据库
之前就被拒绝，并会说明原因。其他人本来就会重启，迁移在打开时执行。本版本之前就存在的 Agent 要用目
标模式，需从插件库装一次 `goal` 插件。用 `skills` / `--skills` 创建 Agent 的脚本改为
`plugins` / `--plugins`。

降级到 0.2.9 在已迁移的数据库上可行（表在它打开时以空表回来）；已结束目标的横幅不会恢复，其他一切
不受影响。以上没有一项是带有效期的垫片：后续版本没有要删的东西。
