# 创建组织时在组织锁内写入目录布局

- **Date:** 2026-10-10
- **Type:** fix
- **Scope:** `server`
- **PR:** [#957](https://github.com/Prism-Shadow/penguin-harness/pull/957)

[English](2026-10-10-org-create-under-lock.md)

创建组织现在在组织的锁内写入目录布局——骨架、`org_config.toml`、`org_chart.yaml`、手册——并创建 CEO 的 Agent；删除组织把目录移入回收站时持有的正是同一把锁。创建进行中到达的删除会等待，随后看到的要么是尚不存在的目录，要么是完整的组织；它不再可能把写了一半的目录移走、让创建继续在一份已不存在的配置旁写文件（留下一个任何列表都不显示的目录，以及占着该 id 的 CEO Agent）。前置检查——id、使命、时区、id 是否空闲——仍在加锁前进行。
