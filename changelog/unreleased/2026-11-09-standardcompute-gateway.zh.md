# 新增 Standard Compute 网关分组

- **Date:** 2026-11-09
- **Type:** feature
- **Scope:** `model-catalog`, `web`, `cli`, `docs`, `plugins`

[English](2026-11-09-standardcompute-gateway.md)

[Standard Compute](https://standardcompute.com) 作为 OpenAI 兼容网关加入了内置分组，默认顺序排在 Runcrate 与 Z.AI 之间。其条目通过预置 base URL `https://api.stdcmpt.com/v1` 走 MMSP 通用的 Chat Completions 客户端，与 Atlas Cloud、Runcrate 分组同路，因此无需新增客户端。与 Runcrate 一样，该分组固定 `openai-chat` 协议并接受手动添加的模型（分组头的**添加模型**、`penguin config model add --provider standardcompute`），添加的模型跟随分组的端点与协议：该网关列出的模型多于目录预置的条目。`penguin-config` 技能（`2026.11.09.1`）把 `standardcompute` 列入可手动添加模型的分组。与所有网关分组一样，它记录 `OPENAI_*` 这对变量但从不回退读取，因此 Standard Compute 条目需要自己的 key 或分组密钥。key 在 [standardcompute.com/dashboard](https://standardcompute.com/dashboard) 签发。

## 条目

模型 id、上下文窗口与输入模态于 2026-11-09 读自该网关的公开目录 API（`GET https://api.stdcmpt.com/v1/models`，无需凭证）。该网关按套餐计费，API 不列每 Token 价格，因此条目不带 `pricing`：成本中心将其视为未计价，而非免费。

- `StandardCompute`（**Standard Compute (routed)**），该网关的路由 id：每个请求发往能处理它的最便宜的已启用模型，并自动回退。上下文窗口 1,000,000 Token，纯文本（列表未给出该路由 id 的输入模态）。
- `deepseek/deepseek-v4-pro`（**DeepSeek V4 Pro**），同一列表中的固定 id，上下文窗口 1,048,576 Token，纯文本。

## 既有 Project

预置条目在创建 Project 时复制进去，因此新建的 Project 立即带上该分组。既有 Project 可通过模型页的**同步新增模型**加入这些条目，同时写入该分组的端点与协议。
