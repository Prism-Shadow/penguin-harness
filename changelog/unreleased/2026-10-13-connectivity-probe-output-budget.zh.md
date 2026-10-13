# 连通探测给推理模型留出足够回答的输出预算

- **Date:** 2026-10-13
- **Type:** fix
- **Scope:** `server`

[English](2026-10-13-connectivity-probe-output-budget.md)

模型连通测试原先发送 `maxTokens: 16`。推理模型会把这份预算整个花在隐藏思考上——以 `finish_reason: "length"` 结束、没有任何可见内容，于是探测报告失败，而端点其实完好。

## 预算

`MODEL_PROBE_MAX_TOKENS` 是普通探测的输出预算，默认 1024，可用 `PENGUIN_MODEL_PROBE_MAX_TOKENS` 覆盖。对直接作答的模型，探测依然只花掉几个 token；对先思考的模型，它现在有空间把回答说完并被判定。speed 模式保留自己的 64-token 上限，它的 TTFT/TPS 读数正是按这个上限标定的。

## 细节

- 探测提示词、`maxTokens` 参数，以及描述旧预算的两处注释——包括 `api/types.ts` 里 speed 模式开关上的那条——现在都写明各模式实际花多少。
