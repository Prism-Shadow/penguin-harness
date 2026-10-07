# 合为一个提案 Skill，被拒的写操作把员工指向它

- **Date:** 2026-10-07
- **Type:** feature
- **Scope:** `agent-company-proposals`, `company-proposals`, `server`, `docs`, `landing`

[English](2026-10-07-penguin-proposal-skill.md)

`agent-company-proposals`（2026.10.07.1）以一个 Skill `penguin-proposal` 取代了 `proposal-author`、`proposal-implementer` 与 `proposal-tester`；员工的提案或路线图写操作被拒或失败时，会被告知先加载它。

## 细节

- `penguin-proposal` 按角色分节：作者、实施者、测试者、路线图成员与路线图主持人。路线图两节给出可直接运行的 `penguin org action run` 命令及其陷阱——`roadmap.draft` 会替换全部条目、新 brief 不带 `proposal` 字段、`roadmap` 类条目会派生子路线图、已有提案用关联而非批准、改条目前先重开、改完再确立、频道里转交的任务不等于授权——并说明 `not_established`、`item_not_found` 与 `items[n].proposal must be a proposal number` 的含义。
- company-proposals 给作者或实施者安装 Skill 插件时，会顺带从该员工身上移除三个退役的 Skill。`AgentLifecycle` 新增 `removeSkill`。
- 员工调用的提案或路线图 Action 被拒或失败时，应答多一行：若尚未加载 `penguin-proposal`，先加载，并给出其 `SKILL.md` 的位置。人收到的应答与运行记录不变。
- 文档的 Skill 页、落地页与插件 README 改用新 Skill 名。

## 兼容性

- 身上已有三个旧 Skill 的员工会保留它们，直到 company-proposals 下次为其安装 Skill 插件（写或做一份提案时）。按名称移除的逻辑待本次改动之前入职的员工都经历过一次这样的安装后删除。
