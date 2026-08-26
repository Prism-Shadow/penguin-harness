# web.db 的升级方向由测试钉住

- **Date:** 2026-08-27
- **Type:** process
- **Scope:** `server`
- **PR:** [#483](https://github.com/Prism-Shadow/penguin-harness/pull/483)

[English](2026-08-27-web-db-upgrade-direction-tests.md)

`openDatabase`此前只覆盖了已发布构建在磁盘上会遇到的三种形态之一：某一列出现之前就已形成的
`sessions` 表。此次补上另外两种，两者都从真实的 `SCHEMA_SQL` 推导而来，而非手抄一份 DDL 副本，
沿用该文件既有的写法。

## 细节

- 在 `messaging_bindings` 出现之前形成的数据库——即 0.2.4 及更早版本写出的每一个 `web.db`——在
  打开时会拿到该表及其 `idx_messaging_account` 唯一索引，原有的 Session 保持不变，随后即可写入
  binding。唯一性由一条绕过 `MessagingBindingsRepo` 自身预检的裸 `INSERT` 断言：只有这样的写入
  才会真正落到索引上，而不是停在仓储层的 SELECT。
- 由**更新**的构建写出、再由当前构建打开的数据库：未知的表、`sessions` 上未知的列，以及建立在该
  列上的索引都原封不动地熬过这次打开，当前构建也照常读写它自己拥有的那些行。用户升级后不喜欢、
  又装回上一个版本，产生的正是这种形态。
- 这份容忍的边界也钉在了旁边：两种纯追加、什么都没删掉的变更——当前构建会写入的表上多出一个没有
  默认值的 `NOT NULL` 列，以及建立在它已经在写的列上的新唯一索引——都会让打开照常成功，却在第一次
  写入时失败。

这些测试把每个方向所依赖的前提，钉在了未来某次 schema 变更会打破它的位置上。
