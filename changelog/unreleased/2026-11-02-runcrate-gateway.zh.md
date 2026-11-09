# 新增 Runcrate 网关分组

- **Date:** 2026-11-02
- **Type:** feature
- **Scope:** `model-catalog`, `ui`, `web`, `cli`, `docs`, `plugins`

[English](2026-11-02-runcrate-gateway.md)

[Runcrate](https://runcrate.ai) 作为开源权重模型的 OpenAI 兼容网关加入了内置分组，默认顺序排在 Atlas Cloud 与 Z.AI 之间。其条目通过预置 base URL `https://api.runcrate.ai/v1` 走 MMSP 通用的 Chat Completions 客户端，与 Atlas Cloud、SiliconFlow、Fireworks AI、TokenDance 和两个 Qwen 网关分组同路，因此无需新增客户端。与 Atlas Cloud 一样，该分组固定 `openai-chat` 协议并接受手动添加的模型（分组头的**添加模型**、`penguin config model add --provider runcrate`），添加的模型跟随分组的端点与协议：该网关提供的开源权重模型多于目录预置的条目。`penguin-config` 技能（`2026.11.02.1`）把 `runcrate` 列入可手动添加模型的分组。与所有网关分组一样，它记录 `OPENAI_*` 这对变量但从不回退读取，因此 Runcrate 条目需要自己的 key 或分组密钥。凡显示服务商图标之处，该分组都显示 Runcrate 应用图标中的 `>_` 提示符标志。

## 条目

模型 id、上下文窗口、输入模态与价格于 2026-11-02 读自该网关的目录 API（`GET https://api.runcrate.ai/v1/models`）。其价格以每 Token 美元计，条目按每百万 Token 存储。API 列出的缓存写入价等于输入价，因此 `cache_write` 取输入价。所选条目是其他网关分组预置的 DeepSeek、Qwen 与 GLM 模型：

- `deepseek-ai/DeepSeek-V4.1-Flash`（**DeepSeek V4.1 Flash**），上下文窗口 1,048,576 Token，支持图片输入。
- `Qwen/Qwen3.6-35B-A3B`（**Qwen 3.6 35B A3B**），上下文窗口 262,144 Token，支持图片输入。
- `zai-org/GLM-5.3`（**GLM-5.3**），上下文窗口 1,048,576 Token，纯文本。

## 既有 Project

预置条目在创建 Project 时复制进去，因此新建的 Project 立即带上该分组。既有 Project 可通过模型页的**同步新增模型**加入这些条目，同时写入该分组的端点与协议。
