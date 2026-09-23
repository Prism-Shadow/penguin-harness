# 向后兼容：重挂前的链戳过的数据根没有模型表

- **Date:** 2026-09-23
- **Type:** process
- **Scope:** `server`
- **PR:** [#TBD](https://github.com/Prism-Shadow/penguin-harness/pull/TBD)

[English](2026-09-23-backward-compatibility.md)

## 按旧编号戳过的数据根会跳过 main 的两张模型表

链重挂到 main 时，main 的 `model-promotions` 与 `model-provider-auth-tokens` 两个迁移插到了 9、10 号，其后的迁移
整体后移两位。重挂之前跑过链的数据根按旧编号戳在 16——旧编号里 9、10 是 `sessions-sandbox` 与 `machines-columns`——
于是重挂后第一次推送把两个模型迁移都当成已执行，一路到 18 却没有 `model_promotions` 与 `model_provider_auth_tokens`，
凡成本或供应商鉴权读它们的地方都答 500：Models 页、组织总览。正式实例在那次推送上就是这样。

迁移 19 `model-tables-adoption` 重跑 9、10 各自的 DDL——冻结副本，都是 `IF NOT EXISTS`——按正常次序跑过它们的根什么
也不会发生。无需手动处理：下一次推送在 swap 路径上运行它。

## 兼容性

等到不再有数据根可能带着重挂前的编号——链合并后的那次发布是检查的时机——即可删除本条；迁移 9、10 本身保留。
