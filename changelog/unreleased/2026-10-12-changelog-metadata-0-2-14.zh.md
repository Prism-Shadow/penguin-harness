# 未发布的 changelog 条目补全元数据

- **Date:** 2026-10-12
- **Type:** process
- **Scope:** `changelog`
- **PR:** [#1079](https://github.com/Prism-Shadow/penguin-harness/pull/1079)

[English](2026-10-12-changelog-metadata-0-2-14.md)

`changelog/unreleased/` 里各条目的元数据按 `changelog/README.md` 补齐，赶在发布时目录改名、冻结之前。除了一处写错的迁移编号，改动只涉及元数据块、对应语言的链接与两份兼容性记录的小节标题，没有改写任何条目对其改动的叙述。

- **PR 链接。** 没有 `PR` 字段的条目补上了加入它的 PR。后来被另一个 PR 修订、而那个 PR 改变了它所描述内容的条目，两个 PR 都列出。所引 PR 未合并就关闭、或只合并进了堆叠分支而没有进 `main` 的条目，再补上把它带进 `main` 的 PR。
- **类型。** 四种取值之外的写法（`feat`、`feature, fix`、`test`、`improvement`）改为 `feature` 或 `process`。两份类型写作 `feat` 与 `feature` 的兼容性记录改为 `process`，与其余兼容性记录一致。
- **格式。** 有一个条目的元数据是纯文本、也没有对应语言的链接，改成了标准元数据块并补上双向链接。没加反引号的 Scope 标识补上反引号；有一处对应语言链接写作 `[中文]`，改为 `[中文版]`。
- **兼容性小节。** 两份设了 `Breaking` 的兼容性记录，把 `## What users need to do`（`## 用户需要做什么`）小节改名为 `## Compatibility`（`## 兼容性`），开头的「不需要做任何事。」随新标题改为「升级无需操作。」。
- **迁移编号。** `2026-10-11-session-archive` 把新增 `kept_at` 的 schema 迁移写成了 15，实际是迁移 16（`sessions-kept-at`）。
