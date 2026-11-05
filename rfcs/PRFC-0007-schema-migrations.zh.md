# PRFC-0007 schema 的改动是有序、带戳、只跑一次的迁移

[English](PRFC-0007-schema-migrations.md)

> **来源**：设计仓 [penguin-harness-design](https://github.com/Prism-Shadow/penguin-harness-design) 的 `rfcs/PRFC-0007-schema-migrations.md`——落地于默认分支 `main`（提交 [`ac673a24`](https://github.com/Prism-Shadow/penguin-harness-design/commit/ac673a245eec78d6afca35e260dce28b2a3ab3ac)）。
> **修订**：v1.0.0（迁入主仓）；本面的约定见 [README.zh.md](README.zh.md)，逐版本改动记在文末 `## Changes`。

- Feature Name: `schema-migrations`
- Start Date: 2026-09-02
- PRFC PR: [Prism-Shadow/penguin-harness-design#111](https://github.com/Prism-Shadow/penguin-harness-design/pull/111)
- Implementation PR: [Prism-Shadow/penguin-harness#524](https://github.com/Prism-Shadow/penguin-harness/pull/524)

## Summary
[summary]: #summary

`web.db` 的 schema 改动写成有序、带版本戳、只跑一次的迁移。其中一条轴是热更新逼出来的：一条迁移必须声明自己在**可被回滚的启动路径**上跑是否安全，不安全的那些在碰数据库之前整批拒绝。

## Motivation
[motivation]: #motivation

### 「每次改动都保持增量」从来不是谁选的策略

`schema.ts` 声明的是一个**全新**数据库被创建成什么样。它表达不了一次**改动**：反复执行 `CREATE TABLE IF NOT EXISTS` 只会把数据库朝当前声明收敛，既不知道、也不记录它从哪个状态来。

于是没有任何一个构建分得出一个 0.2.4 的库和一个 0.2.7 的库。「每次改动都保持增量」听上去像一条纪律，实际上是当时**唯一够得着**的安全性质——因为任何非增量的改动都无从判断该不该做。

### 一次真实的失败

一台跑着 0.2.4 的服务器，两次拒绝了推送过来的新平台，报 `no such table: messaging_bindings`，两次都回滚了。

原因是：那张表是新平台的业务需要的，而它只存在于新版本的 `schema.ts` 里。那台服务器的 runtime 永远不会因为重启而长出这张表——它自己的声明里从来没有。推送带来的是平台代码，不是数据库形状。

这台服务器要么升级 runtime（一次重装），要么永远收不到这次推送。而热更新的全部价值就在于不必这样。

## Guide-level explanation
[guide-level-explanation]: #guide-level-explanation

写一次 schema 改动，就是加一条迁移：一个版本号、一段 `up`、一段 `down`（没有就显式写 `null`），以及一个 `swapSafe` 标志。

`swapSafe` 问的是一个具体的问题：**如果这条迁移跑完之后，接管数据库的是比它更旧的那一版平台，那一版会不会出事？** 加一张表、加一列，旧平台根本不知道它们存在，也就从不碰它们——安全。删一列、加一个 NOT NULL 约束、改一个类型，旧平台会撞上——不安全。

这个问题之所以要问，是因为推送来的平台在活的数据库上启动，**启动失败就回滚到它的前一版**，而前一版要面对迁移已经做完的事。

于是两条路径分开：

| 谁在跑 | 能跑什么 |
| --- | --- |
| `openDatabase`——拥有这个进程 | 什么都能跑 |
| 热推送的启动路径——可能被回滚 | 只跑 `swapSafe` 的，其余在碰数据库之前**整批拒绝**并报 `RestartRequiredError` |

原本要靠评审记着的纪律，就此变成机械的。

## Reference-level explanation
[reference-level-explanation]: #reference-level-explanation

### DDL 冻结

一条迁移写死自己的 SQL，从不 import `SCHEMA_SQL`。引用活的声明会让一条旧迁移在每次 schema 变动之后**悄悄改变含义**——而「这条迁移当年到底做了什么」可查，正是迁移之所以可审计的全部性质。

### 单向、有序、不改写

版本自 1 起连续，发布之后不重编号、不改写。一个已经盖过版本 N 的数据库永远不会再跑 N，所以编辑 N 只改变新库拿到的东西，并把新旧两者悄悄分叉。

这条规则在评审期间真的咬了一次：0.2.8 在评审途中落地，新增的字段成了**第 2 条迁移**，而不是去改第 1 条——因为线上那台服务器已经盖过 1，永远不会再跑它。规则自己做了决定，不是谁的偏好。

### 迁移由热推送路径应用

因为它是唯一够得到比迁移更**旧**的 runtime 的路径。推送来的平台自带迁移，表因此随推送一起走，那台 0.2.4 的服务器现在跑着当前的业务，而它的 runtime 一次都没有重装。

### `down` 不是热更新的回滚

推送的平台启动失败时，runtime 回到前一版，**schema 停在迁移留下的地方**。

在一个刚刚启动失败的进程里撤销 DDL，等于对一个半知半解的状态跑破坏性语句。而 `swapSafe` 存在的意义正是让「不撤销」是安全的：前一版根本不知道那张新表或新列，也就从不碰它。

`down` 是运维手动调用的工具，按版本从新到旧执行，每条连同它的版本戳在一个事务里；范围内只要有一条不可逆，就在碰数据库之前**整批拒绝**——否则数据库会停在一个没人写下过其含义的版本上。它天然有损，每条 `down` 都要说清自己丢掉的是哪些行。

### 迁移必须幂等

迁移出现之前形成的数据库一律读作版本 0，而它们的实际形状各不相同，所以一条迁移必须容忍发现自己的活已经被干过。

这不只是第一条迁移的事：`SCHEMA_SQL` 仍然完整声明当前形状，打开数据库时那份 `ensureColumn` 清单仍然在跑，因此**任何**一条迁移都可能遇到声明式那条轨道已经替它做完的情况。等到声明被冻结到一个基线，一条会大声失败的裸 `CREATE TABLE` 才成为要点。

## Drawbacks
[drawbacks]: #drawbacks

**两条轨道并存。** 声明式那条（`SCHEMA_SQL` 加上它那份 `ensureColumn` 清单与几处索引退役）与迁移这条同时活着，读代码的人要知道一张表可能由任一条产生。冻结声明为基线要牵动全部既有的表，只能另开一次改动。

**幂等是一项长期负担**，而且它只在中间态里必要——但中间态要持续到基线冻结为止，期间每条新迁移都要带着它写。

**列的顺序永久不对齐。** `ALTER TABLE ADD COLUMN` 追加在末尾，全新库把列放在声明里的位置。对齐意味着重建表，那不是增量的，会把回滚的保证一并带走。所以「同一版本的两个库，schema 等价但列序不同」是要接受的事实（索引内的列顺序则必须一致——对复合索引而言那个顺序就是索引本身）。

**`swapSafe` 要靠作者判断。** 没有任何机械手段能验证一条迁移标错了；标错的后果是回滚之后旧平台撞上它不认识的形状。

## Rationale and alternatives
[rationale-and-alternatives]: #rationale-and-alternatives

**继续只用声明式**（现状）。它表达不了改动，因此每一次非增量的想法都只能放弃——而放弃的理由不是「不该做」，是「没办法安全地做」。那台 0.2.4 服务器的两次回滚就是这条路的终点。

**用一个现成的迁移库**（Knex、Drizzle、Prisma migrate 一类）。它们都提供有序带戳的迁移，但没有一个有 `swapSafe` 这根轴——它们假定跑迁移的那个进程就是接下来要服务的进程。这里的前提不同：跑迁移的平台可能在几秒后被回滚掉，而接管的是一个更旧的版本。这根轴是本设计的核心，不是可以外包的部分。

**取消 `swapSafe`，一切改动都要求重启。** 简单，但它等于宣布「凡涉及数据库的功能都不能热推」，而这套 harness 的大半功能都涉及数据库。

**启动失败时自动跑 `down`。** 听上去对称，实际上是在一个刚刚失败的进程里对半知半解的状态跑破坏性语句。`swapSafe` 让不撤销成为安全的选项，这比让撤销变得可靠要容易得多，也诚实得多。

## Prior art
[prior-art]: #prior-art

**Rails 的 ActiveRecord migrations** 立下了这个形状：有序、带版本戳、只跑一次、有 up 与 down。本设计的骨架直接来自它。

**Flyway** 有一条与「不改写已发布的迁移」完全相同的铁律：一条已经应用过的迁移不可编辑，Flyway 用校验和实测这一点。我们靠的是「已盖过 N 的库永不再跑 N」这个事实，效果一致——编辑它只会让新旧两条路分叉。

**expand / contract（并行变更）模式**是 `swapSafe` 的正统前身。滚动发布里，新旧两版代码会同时对着同一个数据库跑，因此 schema 改动要拆成两步：expand 阶段只做增量，与旧代码兼容；contract 阶段做收窄，必须等到旧代码全部下线之后。我们的 `swapSafe` 就是 expand 阶段，只是触发条件不同——不是「等旧代码下线」，而是「这一次启动可能会回滚到旧代码」。

**Django 的迁移**多一层依赖图与自动生成，适合多个应用各自演进 schema 的场景。这里只有一个数据库、一条线性历史，那层复杂度买不到什么。

## Unresolved questions
[unresolved-questions]: #unresolved-questions

**什么时候把 `SCHEMA_SQL` 冻结成基线**——它牵动全部既有的表——以及冻结时怎么处理那些形状各异的存量库——这一步做完，幂等的负担才能卸下。

**要不要给运维一个显式的「我知道会重启，跑吧」的开关**，让非 `swapSafe` 的迁移能在推送路径上被有意放行。今天是无条件拒绝，这更安全，但也意味着某些改动必须走重装。

## Future possibilities
[future-possibilities]: #future-possibilities

Machine 让这件事多一个维度：每台机器各有自己的数据根与数据库，一次推送因此会同时面对若干个处在不同版本的库。今天每台各自迁移、互不知情；「这一批机器的数据库分别在哪个版本」是一个还没有人回答、但迟早要回答的问题。

## Changes

### v1.0.0

- 新增：迁入主仓；正文取设计仓的同一版本，与英文版逐节对应。
