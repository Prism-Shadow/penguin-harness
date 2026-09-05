# Agent 从 `CWD` 向下搜索,本地开发实例一次只跑一个

- **Date:** 2026-09-03
- **Type:** fix
- **Scope:** `core`, `skills`
- **PR:** [#604](https://github.com/Prism-Shadow/penguin-harness/pull/604)

[English](2026-09-03-search-scope-and-dev-instance-rules.md)

默认 System Prompt 从未说过 Agent 该到哪里去找文件,于是一条解析不到的路径换来的是把搜索根往外扩——`find /`、遍历用户主目录、扫描整块磁盘。这既慢,又会读到与任务毫不相干的文件。Prompt 现在会引导 Agent 从 `CWD` 向下搜索、优先收窄而非放大范围,两个仓库开发用 Skill 也补上了面向 PenguinHarness 开发者的对应引导。

## 细节

- 默认 System Prompt 的 `# File system` 一节新增一条:搜索从 `CWD` 向下进行——遍历用户主目录或整个文件系统通常不值得;路径解析不到时,优先靠推断项目结构来收窄,而不是把根往外扩。
- 这是一次 kernel 变更(generation `2026-09-03`,prompt tab):Prompt tab 仍是内置默认值的存量 Agent 会在 kernel 更新时拿到该规则,用户改过的则保持原样。
- kernel 记录中那份 #257 之前的重建校验,现在读取该 generation 所发布模板的冻结副本(`core/test/fixtures/toggles-generation-system-prompt.txt`),不再读取实时默认值,因此 Prompt 继续演进也不会失锚。

## 开发用 Skill

- `penguin-harness-dev` 补上了同一条引导的 worktree 版本:点名并列检出的仓库(`../penguin-harness-design`、`../penguin-harness-wt/*`、`../agenthub`)是 worktree 之外通常唯一值得读取的路径,并建议把这条一并转达给 Subagent。同时写明结论应落在 PR 评论与 PR 描述里而非独立报告,以及旁边没有设计仓库的克隆根本没有 `AGENTS.md`,已入库的 Skill 就是它的全部规则。
- `penguin-harness-manual-test` 补上两条:所有 Agent 合计一次只跑一个本地开发实例,因为 Cookie 与 admin claim 跨实例共享,第二个实例会破坏第一个的会话状态;以及服务端打印的首次登录链接归用户打开,不得用 `curl`、浏览器或无头请求去访问。
