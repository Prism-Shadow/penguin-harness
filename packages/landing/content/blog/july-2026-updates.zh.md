---
title: 2026 年 7 月更新：定时任务、Agent State 快照与 Benchmark 记分板
date: 2026-07-17
category: changelog
excerpt: 定时任务、支持导出导入的 Agent State 快照、Benchmark 记分板、模型确定原则与一键安装已合入 main。
---

> 本文基于 PenguinHarness 0.0.1 撰写，之后的版本在部分细节上可能有所不同。

本月有一批面向「稳定进化」的更新合入了 main。Agent 现在可以按计划定时运行，Agent State 会在有风险的修改之前自动快照，评估中心按模型绘制 Benchmark 结果。要点如下。

## 定时任务与 Agent State 快照

- **定时任务。** 每个任务是 `agent_state/schedule/` 下的一个 TOML 文件。按 cron 风格调度，Agent 可以全天候自主工作。
- **Agent State 快照，支持导出导入。** `system_config.yaml` 记录当前的 `version`。在有风险的修改之前，比如一轮优化或一次覆盖当前状态的导入，Agent State 会先保存到 `snapshots/v<version>.tar.gz`。快照随时可以恢复，恢复时保留当前的密钥保险柜。

## 评估中心

- **Benchmark 记分板。** 评估中心新增内置题库、逐题评分和趋势曲线。评估记录按模型分别绘制，每次运行都能直接跳到对应会话的轨迹观测页面。
- **每条评估记下所用模型。** 模型引用从 `benchmark_config` 移到了每条评估上，以 `provider` / `model_id` 成对记录，跨模型对比更直接。

## 模型体系

- **模型确定原则。** 模型由 `(provider, model_id)` 二元组唯一确定。连接信息内联在 Project 配置里对应的模型条目上。凭证留空时，客户端回退到环境变量。
- **自建供应商分组。** 除了内置的厂商分组和 Custom 分组，还可以自建分组。自建分组默认使用 OpenAI 协议，base URL 必填。
- **Node 24 及以上。** 运行时基线提升到 Node ≥ 24。内嵌运行时、CI 和发布流水线都已迁移。

## 安装与体验

- **一键安装。** 仓库根目录新增 `install.sh`，用 `curl | sh` 运行，自动识别 Linux / macOS 与 x64 / arm64。发布产物内嵌 Node 运行时，解压即可运行。
- **技能库改版。** Skill 在运行时以文件为准，Skill 卡片重新设计，并支持快捷调用。内置 Agent 合并为一个 `default_agent`，Agent 的构建与优化完全交给技能库。
- **稳定性修复。** 修复了三个问题：Gemini 连续调用同一个工具时 `tool_call_id` 冲突；滚动区域较矮时，向上滚动流式输出会抖动；WorkGroup 中并行工具调用的耗时显示不准。
