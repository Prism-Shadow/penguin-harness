---
title: 2026 年 7 月更新：定时任务、Agent 快照与评估中心增强
date: 2026-07-17
category: changelog
excerpt: 定时任务调度、Agent State 版本快照与导出导入、Benchmark 记分展示、模型确定原则与一键安装等一批更新已合入主干。
---

本月主干合入了一批与「稳定进化」直接相关的更新，摘要如下。

## 定时任务与 Agent State 快照

- **定时任务调度**：`agent_state/schedule/` 下每个任务一个 TOML 文件，计划调度让 Agent 全天候自主执行。
- **Agent State 版本快照与导出导入**：`system_config.yaml` 以 `version` 标识当前版本，风险修改（优化类修改、导入覆盖）前自动快照到 `snapshots/v<version>.tar.gz`，可随时回退，且恢复时保留现行 vault。

## 评估中心增强

- **Benchmark 记分展示**：内建题库、逐题评分与趋势曲线，评估记录按模型分系列展示，run 可直达对应 Session 的轨迹观测。
- **评估携带模型**：模型引用从 benchmark_config 移到每条 evaluation（`provider` / `model_id` 成对记录），跨模型对比更直观。

## 模型体系

- **模型确定原则**：模型由 `(provider, model_id)` 二元组唯一确定，连接信息内联在 Project 配置的模型条目上；credential 留空时按 client 解析结果回退环境变量。
- **模型页自建分组**：内置厂商分组与 custom 之外，支持用户自建分组（OpenAI 协议缺省、base URL 必填）。
- **运行基线升级 Node ≥ 24**：内嵌运行时同步更新，CI 与发布链路完成迁移。

## 安装与体验

- **一键安装**：仓库根新增 `install.sh`，`curl | sh` 识别 Linux / macOS 与 x64 / arm64，产物内嵌 Node 运行时，解压即用。
- **技能库改版**：Skill 以文件为运行时真源，技能卡片改版并支持快捷调用；内置 Agent 收敛为 default_agent，Agent 构建与优化能力全部由技能库承载。
- **稳定性修复**：Gemini 连续同名工具调用 tool_call_id 冲突、流式输出短滚动区上滑抖动、WorkGroup 并行工具用时统计等问题已修复。
