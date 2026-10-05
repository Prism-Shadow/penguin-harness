# 向后兼容：没有 `notify` 来源的 `action_runs`，没有 `moderator` 列的 `roadmaps`，没有目标列的 `proposal_comments`

- **Date:** 2026-10-04
- **Type:** process
- **Scope:** `company-proposals`, `company-roadmaps`

[English](2026-10-04-backward-compatibility-notify-actions.md)

[工位投递改为通知 Action](2026-10-03-proposal-roadmap-actions.zh.md#通知)，通知的执行以 `via = 'notify'` 记录。在此之前于 `company.db` 中创建的 `action_runs` 表只允许 `via` 取 `'web'`、`'cli'`、`'session'` 与 `'api'`，记不下通知的执行。

## 旧形态：CHECK 较窄的 `action_runs`

选定方案：**原地放宽一次。** Action 注册表打开某个组织的 `company.db` 时，若发现旧的 CHECK，就在一个写事务中重建 `action_runs`：把各行复制到带当前 CHECK 的新表，新表取用旧表的名字，再重建其索引与只追加触发器。各行内容不变；已带当前 CHECK 的表不做改动。

**用户无需任何操作。**

## 旧形态：没有 `moderator` 列的 `roadmaps`

[`roadmap.members`](2026-10-03-proposal-roadmap-actions.zh.md#roadmap-成员) 把指定的主持人记入 `roadmaps.moderator`。在此之前于 `company.db` 中创建的 `roadmaps` 表没有这一列。

选定方案：**原地补列一次。** roadmap 插件打开某个组织的 `company.db` 时，若该表缺这一列，就在一个写事务中补上（`ALTER TABLE … ADD COLUMN moderator TEXT`）。已有各行读出为空，主持人照旧推算。旧版本忽略这一列，回滚时无需撤销任何改动。

**用户无需任何操作。**

## 旧形态：没有目标列的 `proposal_comments`

[评论可以落在目标上](2026-10-05-impl-diff-view.zh.md)——scope 或 tests 的某一条、改动的某个文件、某个文件的一段行——目标记在 `proposal_comments` 的八个可空 `target_*` 列中。在此之前于 `company.db` 中创建的该表没有这些列。

选定方案：**原地补列一次。** 提案插件打开某个组织的 `company.db` 时，若该表缺其中任何一列，就在一个写事务中补上缺的列（`ALTER TABLE … ADD COLUMN`）。已有评论在这些列上都读出为空，这正是落在正文段落上的评论的读法，因此显示与列出都与之前相同。旧版本按列名选取它认识的列、忽略这些列，回滚时无需撤销任何改动；其间写下的带目标的评论在旧版本中不显示目标。

**用户无需任何操作。**

## 何时可以移除

只要仍可能打开 2026-10-04 之前写入的 `company.db`，重建逻辑（`plugins/company-proposals/src/action-store.ts` 中的 `widenRunVia`）就要保留。没有任何已发布版本写过 `action_runs`，因此最迟在第一个包含 Action 注册表的版本发布时即可移除。移除由 company-proposals 插件的维护者负责。

补列检查（`plugins/company-roadmaps/src/schema.ts` 中的 `addRoadmapModerator`）按同样的条件保留：没有任何已发布版本写过 `roadmaps` 表，因此最迟在第一个包含 roadmap Action 的版本发布时即可移除，列本身留在表定义中。移除由 company-roadmaps 插件的维护者负责。

补列检查（`plugins/company-proposals/src/schema.ts` 中的 `addCommentTargets`，标为 `TODO(proposal-comment-targets)`）在仍可能打开 2026-10-05 之前写入的 `company.db` 时保留；最迟在第一个包含 roadmap Action 的版本发布时即可移除，列本身留在表定义中。移除由 company-proposals 插件的维护者负责。
