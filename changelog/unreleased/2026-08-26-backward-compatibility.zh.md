# 向后兼容

- **Date:** 2026-08-26
- **Type:** process
- **Scope:** `server`
- **PR:** [#490](https://github.com/Prism-Shadow/penguin-harness/pull/490), [#493](https://github.com/Prism-Shadow/penguin-harness/pull/493), [#494](https://github.com/Prism-Shadow/penguin-harness/pull/494)
- **Breaking:** yes — 对数据库是单向的：一旦两个 Session 保存了同一个机器人账号，本次改动之前的构建就再也打不开那个 `web.db`

[English](2026-08-26-backward-compatibility.md)

本批改动在存量 `web.db` 上触及三处，都在 `messaging_bindings` 上，也都被凡是打开过带消息绑定的构建
（0.2.5 及以后）的数据库所携带：`idx_messaging_account` 唯一索引，以及尚不存在的两个新增列
`last_inbound_message_id` 与 `line_per_message`。只有索引需要决策；两个新增列记在这里，是为了让来这里
查「我的数据库需要做什么吗？」的读者在同一处拿到全部答案。

## 退役的账号唯一索引

该索引让 `(channel, account_id)` 在全表唯一，这正是「一个机器人账号永久归属于一个 Session」的实
现方式。改为[启用即绑定](2026-08-26-messaging-bind-by-enable.zh.md)之后，多个 Session 可以同时保
存同一个账号，而该索引会拒绝第二次保存。若保留不动，新行为会在一次普通保存上变成 SQLite 的约束
错误。

选定方案：**打开时删除**，在 `openDatabase` 中既有的 `idx_usage_session` 删除语句旁加一条
`DROP INDEX IF EXISTS idx_messaging_account`。同一次打开中 `SCHEMA_SQL` 会在同样的两列上创建
`idx_messaging_by_account`，因此启用守卫所做的按账号查询仍然走索引，查询计划没有变化。删除是安
全的，因为索引是派生物而非数据：每一行都原样保留；从未有过该索引的数据库不受影响（该语句是空
操作）。

用户无需做任何事：删除是自动的，在升级后第一次打开时执行，任何绑定、凭证与记住的会话都不改动。

## 新增的入站水位列

[持久化的重投水位](2026-08-26-messaging-inbound-watermark.zh.md)在 `messaging_bindings` 上新增了
`last_inbound_message_id`。0.2.7 及更早形成的 `web.db` 有这张表但没有这一列，而
`CREATE TABLE IF NOT EXISTS` 从不改动已经存在的表。

选定方案：**打开时 ALTER 补上**，在 `openDatabase` 本就为此维护的清单里加一条
`ensureColumn(db, "messaging_bindings", "last_inbound_message_id", "TEXT")`。该列可空且无默认值，
因此所有存量绑定都以 `NULL` 沿用——对于本构建从未记录过消息 id 的绑定，这是诚实的取值。升级后的
第一条入站消息会写入它，此后该绑定即受重复防护覆盖。

用户无需做任何事，绑定的其余部分也不被读取或改写：凭证、意图与记住的会话都原样保留。

这一半可以干净地降级。旧构建的 `SELECT *` 只是多带一列它不映射的值，它自己的写入也会让该值保持
原样；重复防护退回为进程内有效，而那正是旧构建一贯的行为。

## 单向的那一半

删除无法被旧构建撤销。本次改动之前的构建会在自己的 `SCHEMA_SQL` 中重新创建该唯一索引，而一旦出
现重复的 `(channel, account_id)` 行——第二个 Session 保存同一个机器人时就会出现——该
`CREATE UNIQUE INDEX` 会失败。`openDatabase` 在一切之前先执行 schema，因此失败发生在打开阶段：旧
构建根本无法对该数据库启动。因此，在使用过新行为之后再降级，需要先删除重复的绑定行，每个账号只
保留一个 Session 的那一行。从未把同一账号保存两次的数据库降级无需任何操作。

## 这份兼容要留多久

只要当前构建仍需打开 0.2.5 至 0.2.7 形成的 `web.db`，这条 `DROP INDEX` 就是必需的——实际上等于无
限期保留，代价是每次打开多执行一条空操作语句。它只在允许破坏存量 `web.db` 的版本中移除，并且应
当与紧挨着它的 `idx_usage_session` 删除语句一并清理，两者属于同一类债务。

`last_inbound_message_id` 的 `ensureColumn` 一行与该清单中其他条目寿命相同、移除条件相同——它是
新增列的既定惯例，而不是一份独立的兼容包袱。

## 新增的 `line_per_message` 列

[每行一条消息](2026-08-26-messaging-line-per-message.zh.md)新增了
`messaging_bindings.line_per_message INTEGER NOT NULL DEFAULT 0`，由既有的 `ensureColumn` 列表在打
开时 ALTER 进来——那份列表正是为此存在。它纯属新增，无需任何决策：默认值复现了每份存量绑定原本的送
达方式——每条回复一条消息——因此没有任何绑定的行为改变，没有任何数据被改写，用户也无需做任何事。该
`ensureColumn` 条目的保留期与「本次发布之前形成的 `web.db` 仍可被打开」等长，与该列表中其余条目同一
口径。旧构建则直接忽略一个它从未听说过的列。

## 兼容性

无需任何操作。升级后第一次打开即删除该索引；绑定、凭证与记住的会话都不受影响，从不把同一个机器
人保存到两个 Session 的用户完全感觉不到差别。

降级到本次改动之前的构建之前，两个新增列都无需处理；但若已有账号被保存在多个 Session 上，请先删除
多余的行，否则旧服务端无法打开该数据库。可用以下语句检查：

```sql
SELECT channel, account_id, COUNT(*) FROM messaging_bindings
GROUP BY channel, account_id HAVING COUNT(*) > 1;
```
