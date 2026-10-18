# 成本页改读预聚合的用量表，不再每次扫全表

- **Date:** 2026-10-18
- **Type:** refactor
- **Scope:** `server`
- **PR:** [#1199](https://github.com/Prism-Shadow/penguin-harness/pull/1199)

[English](2026-10-18-usage-daily-rollup.md)

成本页不再每次请求都重新聚合整张 `usage_records`。把一天的记录折叠到一起后数字不变的聚合，现在读一张预聚合表；
同一组参数背后的聚合行会短暂复用，因此期间改动过的价格在下一次读取时就已经生效。

## 细节

- `usage_daily_rollup` 按 `(project_id, date, agent_id, session_id, provider, model_id, peak)` 预先汇总
  `usage_records`。每一列都是同一批行上的求和，而每个分组维度都是这个键里的一列，所以同一条查询从几千行返回的数字，
  与从几十万行返回的完全一致。
- 只有在折叠不改变任何数字时才读这张表：没有价格分级、没有时间戳窗口、也没有指定会话子集。原因是分级由每条记录自己的
  `ts` 判定，而按天折叠的表不带这个时刻。其余情形仍照原样查 `usage_records`。
- `requests` 是折叠唯一可能改变的数字：一行 rollup 已经代表若干次请求，因此每次读 rollup 都对存下的计数求和，
  而不是去数折叠后的行数。
- 这张表是可重建的缓存，本身不持有数据：写入落地时即折进去（UPSERT），而发现表为空后的第一次读取会从
  `usage_records` 重建它，这也是它唯一的恢复路径。
- `UsageService` 缓存的是聚合行而非成品响应，保留 15 秒，键取 Project 加上每一个决定取哪些行的参数。计价每次读取都重算，
  所以新增或改动的价格立刻生效；用量一落地，`UsageRecorder` 就丢弃该 Project 的缓存行，屏幕上已有的数字不会越过它背后的
  token 继续保留。
- `UsageQuery.groupLimit` 把分组结果裁到最近若干组，只对有确定顺序的维度开放（`date`、`agent`、`session`）。
  `model` 的键没有服务端能担保的顺序，路由对它是明确拒绝，而不是返回一个调用方会当成「最近几条」的任意子集。
- 新增 `idx_usage_project_ts` 索引：today 与 last-7d 是按 `ts` 过滤的，而原有的 `(project_id, date)` 索引覆盖的是另一列。
