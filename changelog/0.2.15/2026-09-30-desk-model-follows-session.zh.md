# 公司模式：员工的 Model 以工位会话为准

- **Date:** 2026-09-30
- **Type:** feature
- **Scope:** `server`, `docs`
- **PR:** [#915](https://github.com/Prism-Shadow/penguin-harness/pull/915)

[English](2026-09-30-desk-model-follows-session.md)

员工的 Model 原先读自员工条目，而工位会话可以在会话内切换到另一个 Model（[#748](https://github.com/Prism-Shadow/penguin-harness/pull/748) 的会话内切换）：员工条目仍是旧 Model，该员工的工单会话和下一个工位也还开在旧 Model 上。现在，员工的 Model 就是它当前工位会话所用的 Model。

## Server

- 在员工当前的工位会话里切换 Model——工具条的模型选择器、`/switch-model` 或 API——即员工换 Model：切换完成时，服务端把新 Model 写入 `org_chart.yaml` 里该员工的条目，之后换工位也开在它上面。在工单会话里、或在已被替换的旧工位里切换，只影响那个会话。
- 工单会话开在员工当前工位会话此刻所用的 Model 上。只有员工还没有工位时，才取员工条目的 `model`（其次是组织的，再次是 Project 默认 Model）。
- 员工条目的 `model` 决定的是工位开在哪个 Model 上，即招募时和换工位时。只改它（`penguin org employee set --model-id … --provider …`）不会改动已经开着的工位和它的工单会话。
- Session 的 Model 变动时，会话管理器会通知订阅者（`onModelChanged`），此时 Session 行已是新 Model。

## Docs

- `company-mode`（「工位会话」）与 `cli`（`employee set`），中英文同步。
