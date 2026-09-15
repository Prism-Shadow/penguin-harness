# 轨迹面板按每次请求实际所处的档位计价

- **Date:** 2026-09-10
- **Type:** fix
- **Scope:** `server`, `web`, `docs`
- **PR:** [#659](https://github.com/Prism-Shadow/penguin-harness/pull/659)

[English](2026-09-10-trace-panel-tiered-cost.md)

轨迹面板的逐轮成本与单文件成本改由服务端按成本中心的同一口径计价，因此一个 Session 各 Trace 文件的成本之和，与对话页顶部统计、成本中心为同一批请求给出的数字一致。此前面板把每次请求都按 Project 存储的价格计价，而顶部统计与成本中心按每次请求自己的时间戳判定档位——对分时段计费的模型（DeepSeek 空闲时段半价），面板各文件之和会高于顶部统计，差额正是每次空闲时段请求成本的一半。

## 细节

- Trace 分析响应新增逐轮 `cost` 与文件级 `cost`（USD）：每次 Request 按 Project 当前为该文件模型配置的价格、以该 Request 自己的时间戳所处档位计价——与成本中心为同一条 `token_usage` 落库行计价时所用的价格查询与档位规则完全相同。模型未配置价格、或旧版 Trace 头部没有 provider 时不带 `cost`。
- Trace 文件视图直接读取这些数字，不再自行计价，也不再拉取 Project 的模型列表。
- 计价公式与逐条记录的档位判定抽为 usage service 的共享函数，SQL 聚合与逐文件分析对同一次请求的计价由此一致。
- 文档补充说明：Trace 视图与成本统计不仅共用数据，也共用计价口径。
