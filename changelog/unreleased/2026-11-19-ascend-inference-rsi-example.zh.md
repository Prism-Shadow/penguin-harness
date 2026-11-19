# 昇腾推理 RSI 示例目录

- **Date:** 2026-11-19
- **Type:** feature
- **Scope:** `examples`
- **Issue:** [#88](https://github.com/Prism-Shadow/penguin-harness-community/issues/88)

[English](2026-11-19-ascend-inference-rsi-example.md)

新增 `examples/ascend-inference-rsi/`，作为 Qwen3.8-27B 在 2 × Ascend 950PR 上 vLLM-Ascend 优化运行的固定位置。补丁 bundle、逐轮 RSI 记录以及吞吐与时延报告会随运行逐步加入。

## 目录内容

- `patches/` —— 保留的适配与算子补丁、固定基线 commit、`apply.sh` 与 `restore.sh`。
- `rounds/` 与 `experience.jsonl` —— 每轮一条记录，包含被拒绝的轮次。
- `report.md` —— 吞吐与时延报告，附正确性与噪声结果。
- `assets/` —— 固定 prompt 集、benchmark 调用方式与评测入口。
